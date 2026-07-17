import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  boundedCustodyFailure,
  replayManagedCloudCustody,
  type ReplayManagedCloudCustodyDeps,
} from "./replay-managed-cloud-custody.js";
import type { StripeHttp } from "../fixtures/stripe-test-clock.js";
import { encodeWebhookEndpointIntentRef, webhookEndpointUrl } from "../fixtures/stripe-smoke-resources.js";
import {
  WEBHOOK_CUSTODY_DIRNAME,
  WEBHOOK_INTENT_FILENAME,
} from "../scenarios/managed-cloud-fixture-smoke-1.js";
import {
  loadSharedTemplateCustody,
  markSharedTemplateAcquired,
  markSharedTemplateReleased,
  recordSharedTemplateIntent,
  sharedTemplateCustodyPath,
  type SharedTemplateCustodyIdentityV1,
} from "../worlds/managed-cloud/shared-template-custody.js";
import type { E2bTemplateReceipt } from "../worlds/managed-cloud/template.js";

const TEMPLATE_IDENTITY: SharedTemplateCustodyIdentityV1 = {
  runId: "run-1",
  shardId: "1",
  sourceSha: "a".repeat(40),
  templateName: "proliferate-runtime-qual-run-1",
  inputHash: "b".repeat(64),
};

const TEMPLATE_RECEIPT: E2bTemplateReceipt = {
  artifact_id: `e2b-template/${TEMPLATE_IDENTITY.templateName}`,
  templateId: "tpl_exact_1",
  buildId: "build_exact_1",
  inputHash: TEMPLATE_IDENTITY.inputHash,
  bakedInputs: [{ destination: "/home/user/.local/bin/anyharness", sha256: "c".repeat(64) }],
};

function noProviderDeps(): ReplayManagedCloudCustodyDeps {
  const unexpected = async (): Promise<never> => {
    throw new Error("provider must not be called");
  };
  return {
    listTemplates: unexpected,
    listSandboxes: unexpected,
    killSandbox: unexpected,
    deleteTemplate: unexpected,
  };
}

test("custody replay is a side-effect-free no-op when no pre-world journal exists", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-custody-empty-"));
  try {
    const status = await replayManagedCloudCustody(
      { runDir, runId: "run-1", shardId: "1" },
      {},
      { request: async () => { throw new Error("provider must not be called"); } },
    );
    assert.equal(status, "not_needed");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("custody replay deletes every exact run-owned endpoint from persisted identity", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-custody-replay-"));
  const custodyDir = path.join(runDir, WEBHOOK_CUSTODY_DIRNAME);
  const intentPath = path.join(custodyDir, WEBHOOK_INTENT_FILENAME);
  const subdomain = "replay.qualification.proliferate.com";
  const url = webhookEndpointUrl(subdomain);
  const runTag = "run-1:1";
  let endpoints = ["we_1", "we_2"];
  const http: StripeHttp = {
    async request(_key, request) {
      if (request.method === "GET" && request.path.startsWith("/webhook_endpoints?")) {
        return {
          data: endpoints.map((id) => ({ id, url, metadata: { proliferate_qualification_run: runTag } })),
          has_more: false,
        };
      }
      if (request.method === "DELETE" && request.path.startsWith("/webhook_endpoints/")) {
        const id = request.path.split("/").at(-1);
        endpoints = endpoints.filter((candidate) => candidate !== id);
        return { id, deleted: true };
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    },
  };
  try {
    await mkdir(custodyDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(runDir, "cloud-world-subdomain.json"), JSON.stringify({ subdomain }));
    await writeFile(
      intentPath,
      JSON.stringify({
        intentRef: encodeWebhookEndpointIntentRef(subdomain),
        endpointId: "we_1",
        runTag,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    const status = await replayManagedCloudCustody(
      { runDir, runId: "run-1", shardId: "1" },
      { STRIPE_TEST_SECRET_KEY: "sk_test_replay" },
      http,
    );
    assert.equal(status, "reconciled");
    assert.deepEqual(endpoints, []);
    await assert.rejects(() => readFile(intentPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("custody replay deletes acquired template sandboxes and the exact template before release", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-template-replay-"));
  const journalPath = sharedTemplateCustodyPath(runDir);
  let sandboxIds = ["sbx_1", "sbx_2"];
  let templatePresent = true;
  const calls: string[] = [];
  const deps: ReplayManagedCloudCustodyDeps = {
    listTemplates: async () => templatePresent
      ? [{ templateId: TEMPLATE_RECEIPT.templateId, aliases: [TEMPLATE_IDENTITY.templateName], names: [] }]
      : [],
    listSandboxes: async (templateId) => ({
      matches: sandboxIds.map((providerSandboxId) => ({
        providerSandboxId,
        state: "running" as const,
        templateId,
      })),
      count: sandboxIds.length,
    }),
    async killSandbox(providerSandboxId) {
      calls.push(`kill:${providerSandboxId}`);
      sandboxIds = sandboxIds.filter((candidate) => candidate !== providerSandboxId);
      return { killed: true };
    },
    async deleteTemplate(templateId) {
      calls.push(`delete:${templateId}`);
      templatePresent = false;
    },
  };
  try {
    await recordSharedTemplateIntent(journalPath, TEMPLATE_IDENTITY);
    await markSharedTemplateAcquired(journalPath, TEMPLATE_IDENTITY, TEMPLATE_RECEIPT);
    const status = await replayManagedCloudCustody(
      { runDir, runId: TEMPLATE_IDENTITY.runId, shardId: TEMPLATE_IDENTITY.shardId },
      { RELEASE_E2E_E2B_API_KEY: "e2b_test", RELEASE_E2E_E2B_TEAM_ID: "team_1" },
      { request: async () => { throw new Error("Stripe must not be called"); } },
      deps,
    );
    assert.equal(status, "reconciled");
    assert.deepEqual(calls, ["kill:sbx_1", "kill:sbx_2", `delete:${TEMPLATE_RECEIPT.templateId}`]);
    assert.equal((await loadSharedTemplateCustody(journalPath)).state, "released");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("already-released template custody needs no provider credentials or calls", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-template-released-"));
  const journalPath = sharedTemplateCustodyPath(runDir);
  try {
    await recordSharedTemplateIntent(journalPath, TEMPLATE_IDENTITY);
    await markSharedTemplateAcquired(journalPath, TEMPLATE_IDENTITY, TEMPLATE_RECEIPT);
    await markSharedTemplateReleased(journalPath, TEMPLATE_IDENTITY, TEMPLATE_RECEIPT);
    assert.equal(
      await replayManagedCloudCustody(
        { runDir, runId: TEMPLATE_IDENTITY.runId, shardId: TEMPLATE_IDENTITY.shardId },
        {},
        { request: async () => { throw new Error("Stripe must not be called"); } },
        noProviderDeps(),
      ),
      "not_needed",
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("intent cleanup refuses ambiguous provider templates and preserves custody", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-template-ambiguous-"));
  const journalPath = sharedTemplateCustodyPath(runDir);
  const deps = noProviderDeps();
  deps.listTemplates = async () => [
    { templateId: "tpl_1", aliases: [TEMPLATE_IDENTITY.templateName], names: [] },
    { templateId: "tpl_2", aliases: [], names: [TEMPLATE_IDENTITY.templateName] },
  ];
  try {
    await recordSharedTemplateIntent(journalPath, TEMPLATE_IDENTITY);
    await assert.rejects(
      () => replayManagedCloudCustody(
        { runDir, runId: TEMPLATE_IDENTITY.runId, shardId: TEMPLATE_IDENTITY.shardId },
        { RELEASE_E2E_E2B_API_KEY: "e2b_test", RELEASE_E2E_E2B_TEAM_ID: "team_1" },
        { request: async () => { throw new Error("Stripe must not be called"); } },
        deps,
      ),
      /matches multiple authoritative provider templates/,
    );
    assert.equal((await loadSharedTemplateCustody(journalPath)).state, "intent");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("one custody-domain failure does not prevent independent template reconciliation", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "managed-custody-independent-"));
  const custodyDir = path.join(runDir, WEBHOOK_CUSTODY_DIRNAME);
  const templateJournal = sharedTemplateCustodyPath(runDir);
  const deps = noProviderDeps();
  deps.listSandboxes = async () => ({ matches: [], count: 0 });
  deps.listTemplates = async () => [];
  try {
    await mkdir(custodyDir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(custodyDir, WEBHOOK_INTENT_FILENAME),
      JSON.stringify({
        intentRef: encodeWebhookEndpointIntentRef("missing-sidecar.example.com"),
        endpointId: "we_1",
        runTag: "run-1:1",
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await recordSharedTemplateIntent(templateJournal, TEMPLATE_IDENTITY);
    await markSharedTemplateAcquired(templateJournal, TEMPLATE_IDENTITY, TEMPLATE_RECEIPT);
    await assert.rejects(
      () => replayManagedCloudCustody(
        { runDir, runId: "run-1", shardId: "1" },
        { RELEASE_E2E_E2B_API_KEY: "e2b_test", RELEASE_E2E_E2B_TEAM_ID: "team_1" },
        { request: async () => { throw new Error("Stripe must not be reached without the sidecar"); } },
        deps,
      ),
      /Stripe webhook custody cleanup failed/,
    );
    assert.equal((await loadSharedTemplateCustody(templateJournal)).state, "released");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("custody CLI diagnostics redact provider credentials and stay bounded", () => {
  const message = boundedCustodyFailure(
    new Error(`Stripe sk_test_super_secret E2B e2b_${"x".repeat(32)} ${"A".repeat(900)}`),
  );
  assert.ok(message.includes("[REDACTED_STRIPE_KEY]"));
  assert.ok(message.includes("[REDACTED_PROVIDER_KEY]"));
  assert.ok(!message.includes("super_secret"));
  assert.ok(message.length <= 500);
});
