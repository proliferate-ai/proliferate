import assert from "node:assert/strict";
import { test } from "node:test";

import type { StripeHttp, StripeTestClockTransport } from "../fixtures/stripe-test-clock.js";
import {
  cleanupStripeRun,
  managedCloudProviderRunIdentities,
  reapManagedCloudProvidersForWorkflowAttempt,
  type ProviderCleanupDeps,
  type ProviderCleanupInputs,
} from "./reap-managed-cloud-providers.js";

const INPUTS: ProviderCleanupInputs = {
  workflowRunId: "29602686092",
  workflowRunAttempt: "2",
  sourceSupportsLiteLlmAttribution: true,
  e2bApiKey: "e2b-secret-value",
  e2bTeamId: "team-qualification",
  stripeSecretKey: "sk_test_secret_value",
  litellmBaseUrl: "https://litellm.example",
  litellmMasterKey: "sk-litellm-secret-value",
};

function emptyDeps(calls: string[] = []): ProviderCleanupDeps {
  return {
    async cleanupE2b(runId) {
      calls.push(`e2b:${runId}`);
      return { matchedTemplates: 0, killedSandboxes: 0 };
    },
    async cleanupStripe(runTag) {
      calls.push(`stripe:${runTag}`);
      return {
        deletedWebhookEndpoints: 0,
        deletedTestClocks: 0,
        deletedCustomers: 0,
        matchedProductFamilies: 0,
        deactivationWrites: 0,
      };
    },
    async cleanupLiteLlm(runId, shardId) {
      calls.push(`litellm:${runId}:${shardId}`);
      return { deletedKeys: 0, deletedUsers: 0, deletedTeams: 0 };
    },
  };
}

test("derives only the exact run identity the workflow creates", () => {
  assert.deepEqual(managedCloudProviderRunIdentities("29602686092", "2"), ["qlc-ci-29602686092-2"]);
  assert.throws(() => managedCloudProviderRunIdentities("../prod", "2"), /workflow run id is malformed/);
  assert.throws(() => managedCloudProviderRunIdentities("2", "0"), /workflow run attempt is malformed/);
});

test("runs every provider serially for the exact identity and reports not-needed truthfully", async () => {
  const calls: string[] = [];
  const report = await reapManagedCloudProvidersForWorkflowAttempt(INPUTS, emptyDeps(calls));
  assert.equal(report.status, "not_needed");
  assert.deepEqual(calls, [
    "e2b:qlc-ci-29602686092-2",
    "stripe:qlc-ci-29602686092-2:1",
    "litellm:qlc-ci-29602686092-2:1",
  ]);
});

test("bounded success evidence names every provider resource family separately", async () => {
  const deps = emptyDeps();
  deps.cleanupE2b = async () => ({ matchedTemplates: 1, killedSandboxes: 2 });
  deps.cleanupStripe = async () => ({
    deletedWebhookEndpoints: 1,
    deletedTestClocks: 2,
    deletedCustomers: 3,
    matchedProductFamilies: 4,
    deactivationWrites: 5,
  });
  deps.cleanupLiteLlm = async () => ({ deletedKeys: 6, deletedUsers: 7, deletedTeams: 8 });
  const report = await reapManagedCloudProvidersForWorkflowAttempt(INPUTS, deps);
  assert.equal(report.status, "reconciled");
  assert.deepEqual(report.runs[0]!.e2b.result, { matchedTemplates: 1, killedSandboxes: 2 });
  assert.deepEqual(report.runs[0]!.stripe.result, {
    deletedWebhookEndpoints: 1,
    deletedTestClocks: 2,
    deletedCustomers: 3,
    matchedProductFamilies: 4,
    deactivationWrites: 5,
  });
  assert.deepEqual(report.runs[0]!.litellm.result, {
    deletedKeys: 6,
    deletedUsers: 7,
    deletedTeams: 8,
  });
});

test("one provider failure stays red without stranding other exact provider resources", async () => {
  const calls: string[] = [];
  const deps = emptyDeps(calls);
  deps.cleanupE2b = async (runId) => {
    calls.push(`e2b:${runId}`);
    throw new Error(`provider failed ${INPUTS.e2bApiKey}`);
  };
  const report = await reapManagedCloudProvidersForWorkflowAttempt(INPUTS, deps);
  assert.equal(report.status, "failed");
  assert.equal(report.runs[0]!.e2b.status, "failed");
  assert.ok(report.runs[0]!.e2b.reason?.includes("[REDACTED_PROVIDER_SECRET]"));
  assert.ok(!JSON.stringify(report).includes(INPUTS.e2bApiKey));
  assert.ok(calls.includes("litellm:qlc-ci-29602686092-2:1"));
});

test("a source without LiteLLM attribution remains non-green without blocking E2B or Stripe", async () => {
  const calls: string[] = [];
  const report = await reapManagedCloudProvidersForWorkflowAttempt(
    { ...INPUTS, sourceSupportsLiteLlmAttribution: false },
    emptyDeps(calls),
  );
  assert.equal(report.status, "failed");
  assert.ok(report.runs.every((run) => run.litellm.status === "failed"));
  assert.ok(report.runs.every((run) => run.litellm.reason?.includes("did not prove exact LiteLLM")));
  assert.equal(calls.some((call) => call.startsWith("litellm:")), false);
  assert.equal(calls.filter((call) => call.startsWith("e2b:")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("stripe:")).length, 1);
});

test("missing provider credentials make every domain red without a provider call", async () => {
  const report = await reapManagedCloudProvidersForWorkflowAttempt({
    ...INPUTS,
    e2bApiKey: "",
    e2bTeamId: "",
    stripeSecretKey: "",
    litellmBaseUrl: "",
    litellmMasterKey: "",
  });
  assert.equal(report.status, "failed");
  for (const run of report.runs) {
    assert.equal(run.e2b.status, "failed");
    assert.equal(run.stripe.status, "failed");
    assert.equal(run.litellm.status, "failed");
  }
});

test("Stripe recovery deletes only exact run-owned resources and proves zero", async () => {
  const runTag = "qlc-ci-29602686092-2:1";
  let webhooks = [
    { id: "we_owned", metadata: { proliferate_qualification_run: runTag } },
    { id: "we_foreign", metadata: { proliferate_qualification_run: "other:1" } },
  ];
  let customers = [
    { id: "cus_owned", metadata: { proliferate_qualification_run: runTag } },
    { id: "cus_foreign", metadata: { proliferate_qualification_run: "other:1" } },
  ];
  let products = [
    { id: "prod_owned", active: true, metadata: { proliferate_qualification_run: runTag } },
    { id: "prod_foreign", active: true, metadata: { proliferate_qualification_run: "other:1" } },
  ];
  let prices = [
    { id: "price_owned", product: "prod_owned", active: true },
    { id: "price_foreign", product: "prod_foreign", active: true },
  ];
  let clocks = ["clock_owned_1", "clock_owned_2"];
  const http: StripeHttp = {
    async request(_key, request) {
      const [resourcePath] = request.path.split("?");
      if (request.method === "GET" && resourcePath === "/webhook_endpoints") {
        return { data: webhooks, has_more: false };
      }
      if (request.method === "DELETE" && resourcePath?.startsWith("/webhook_endpoints/")) {
        webhooks = webhooks.filter((row) => row.id !== resourcePath.split("/").at(-1));
        return { deleted: true };
      }
      if (request.method === "GET" && resourcePath === "/test_helpers/test_clocks") {
        return { data: clocks.map((id) => ({ id, name: `proliferate-qual-renew-${runTag}` })), has_more: false };
      }
      if (request.method === "GET" && resourcePath === "/customers") {
        return { data: customers, has_more: false };
      }
      if (request.method === "DELETE" && resourcePath?.startsWith("/customers/")) {
        customers = customers.filter((row) => row.id !== resourcePath.split("/").at(-1));
        return { deleted: true };
      }
      if (request.method === "GET" && resourcePath === "/products") {
        return { data: products, has_more: false };
      }
      if (request.method === "GET" && resourcePath === "/prices") {
        const product = new URLSearchParams(request.path.split("?")[1]).get("product");
        return { data: prices.filter((row) => row.product === product), has_more: false };
      }
      if (request.method === "POST" && resourcePath?.startsWith("/prices/")) {
        prices = prices.map((row) => row.id === resourcePath.split("/").at(-1) ? { ...row, active: false } : row);
        return { active: false };
      }
      if (request.method === "POST" && resourcePath?.startsWith("/products/")) {
        products = products.map((row) => row.id === resourcePath.split("/").at(-1) ? { ...row, active: false } : row);
        return { active: false };
      }
      throw new Error(`unexpected Stripe request ${request.method} ${request.path}`);
    },
  };
  const transport = {
    async findTestClockByName() {
      return clocks[0] ? { testClockId: clocks[0] } : null;
    },
    async deleteClock({ testClockId }: { testClockId: string }) {
      clocks = clocks.filter((id) => id !== testClockId);
    },
  } as unknown as StripeTestClockTransport;

  const result = await cleanupStripeRun(runTag, INPUTS, http, transport);
  assert.deepEqual(result, {
    deletedWebhookEndpoints: 1,
    deletedTestClocks: 2,
    deletedCustomers: 1,
    matchedProductFamilies: 1,
    deactivationWrites: 2,
  });
  assert.deepEqual(webhooks.map((row) => row.id), ["we_foreign"]);
  assert.deepEqual(customers.map((row) => row.id), ["cus_foreign"]);
  assert.equal(products.find((row) => row.id === "prod_owned")?.active, false);
  assert.equal(products.find((row) => row.id === "prod_foreign")?.active, true);
  assert.equal(prices.find((row) => row.id === "price_owned")?.active, false);
  assert.equal(prices.find((row) => row.id === "price_foreign")?.active, true);
});

test("Stripe accepted clock deletion cannot become green while the exact name remains", async () => {
  const runTag = "qlc-ci-29602686092-2:1";
  const http: StripeHttp = {
    async request(_key, request) {
      if (request.path.startsWith("/webhook_endpoints")) return { data: [], has_more: false };
      if (request.path.startsWith("/test_helpers/test_clocks")) {
        return { data: [{ id: "clock_owned", name: `proliferate-qual-renew-${runTag}` }], has_more: false };
      }
      throw new Error(`unexpected Stripe request ${request.method} ${request.path}`);
    },
  };
  const transport = {
    async findTestClockByName() { return { testClockId: "clock_owned" }; },
    async deleteClock() { return undefined; },
  } as unknown as StripeTestClockTransport;
  await assert.rejects(
    () => cleanupStripeRun(runTag, INPUTS, http, transport),
    /still reports exact run-owned test clocks/,
  );
});
