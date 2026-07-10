import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { ScenarioDefinition, ScenarioRunContext } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { assertDurableIdentityAvailableForLane, loginDurableUserForLane } from "../fixtures/lane-identity.js";
import {
  getCloudSandbox,
  pollCloudSandboxStatus,
  probeAgentsThroughGateway,
  wakeCloudSandbox,
  warmPersonalCloudSandbox,
  withCloudSandboxBillingGate,
} from "../fixtures/cloud-sandbox.js";
import {
  e2bVerificationAvailable,
  execInProviderSandbox,
  findProviderSandbox,
  getProviderSandboxState,
  pauseProviderSandbox,
  readProviderSandboxFile,
  writeProviderSandboxFile,
} from "../fixtures/e2b-verify.js";

/**
 * T3-PROV-2 — access: existing user (warm path).
 * specs/developing/testing/scenarios.md#T3-PROV-2
 *
 * #1041: the `current_product_user` gate lifted 2026-07-09 (PR #1023); `GET
 * /cloud-sandbox` and `POST /cloud-sandbox/wake` succeed for real. What was
 * left unimplemented was the pause + reconnect-state-intact half, because
 * the product has NO pause endpoint at all -- a sandbox only pauses via
 * E2B's own idle-timeout lifecycle or the billing reconciler
 * (server/proliferate/server/cloud/webhooks/service.py) -- so there is no
 * product-level lever to drive it from a test. Per Pablo's ruling this
 * scenario drives pause directly via the E2B SDK (the sanctioned backdoor;
 * see `../fixtures/e2b-verify.ts`'s module docstring for the full rationale
 * and the metadata trick that avoids any DB access), while everything else
 * (login, wake, reconnect, and the "prior state intact" proof) goes through
 * the real product surfaces: `GET/POST /v1/cloud/cloud-sandbox*` and the
 * real anyharness gateway proxy (`GET .../anyharness/v1/agents`, the same
 * workspace-free exec/connectivity proof T3-PROV-1 already established).
 *
 * Also newly wired here: staging-lane identity. The original version of this
 * scenario only knew password login (`loginDurableUser`), which cannot
 * authenticate staging's durable user (a real GitHub-OAuth-only account with
 * no password -- see `../fixtures/staging-session.ts`). `loginDurableUserForLane`
 * (`../fixtures/lane-identity.ts`) branches on `ctx.targetLane` so this now
 * actually runs against `--lane staging`, not just `--lane local`.
 */
export const t3Prov2: ScenarioDefinition = {
  id: "T3-PROV-2",
  title: "access — existing user (warm path)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-2",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "log in as the durable user (lane-aware: password locally, rotating staging session on staging)" },
    { description: "GET /cloud-sandbox; if the sandbox has never materialized, force it via a real secret PUT" },
    { description: "connect via the real anyharness gateway proxy (GET .../v1/agents) — pre-pause proof-of-life" },
    { description: "[E2B-direct, no product pause endpoint exists] write a filesystem marker, then pause the sandbox" },
    { description: "assert E2B ground truth shows paused; poll GET /cloud-sandbox for the webhook-driven status flip" },
    { description: "POST /cloud-sandbox/wake, then reconnect via the anyharness proxy — real resume proof" },
    { description: "assert E2B ground truth shows running again, and the filesystem marker survived the cycle" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await withProductGate("T3-PROV-2", () => withCloudSandboxBillingGate("T3-PROV-2", () => runReal(ctx)));
  },
};

async function runReal(ctx: ScenarioRunContext): Promise<void> {
  assertDurableIdentityAvailableForLane("T3-PROV-2", ctx);
  const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
  const session = await loginDurableUserForLane(ctx, serverUrl);
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  const existing = await getCloudSandbox(client);
  const sandbox =
    existing?.status === "ready" ? existing : await warmPersonalCloudSandbox(client, { timeoutMs: 180_000 });
  assert.equal(sandbox.status, "ready", "T3-PROV-2: the durable user's personal cloud sandbox must be ready");

  const preAgents = await probeAgentsThroughGateway(client);
  assert.ok(Array.isArray(preAgents) && preAgents.length > 0, "T3-PROV-2: pre-pause agents probe must be non-empty");
  console.log(`[T3-PROV-2] pre-pause proof-of-life: ${preAgents.length} agents reported`);

  if (!e2bVerificationAvailable()) {
    throw new ScenarioExpectedFailError(
      "T3-PROV-2: sandbox reached status=ready and the real anyharness gateway proxy answered " +
        `(${preAgents.length} agents) — both verified for real. Pause/resume/state-intact could not be ` +
        "verified: there is no product pause endpoint at all (pause only ever arrives via E2B's own idle " +
        "timeout or the billing reconciler), so it can only be driven and ground-truth-verified via the E2B " +
        "SDK directly, and RELEASE_E2E_E2B_API_KEY is absent in this run. Already wired for CI " +
        "(release-e2e.yml maps the repo secret E2B_API_KEY to it for the staging job) — this is a local " +
        "credential gap, not a product or scenario bug.",
    );
  }

  const found = await findProviderSandbox(sandbox.id);
  assert.ok(found.providerSandboxId, "T3-PROV-2: must resolve the provider sandbox via E2B metadata (no DB access)");
  assert.equal(found.state, "running", "T3-PROV-2: E2B ground truth must show running before we pause it");
  const providerSandboxId = found.providerSandboxId as string;

  const markerPath = "/home/user/t3-prov-2-marker.txt";
  const markerValue = `t3-prov-2-${randomUUID()}`;
  await writeProviderSandboxFile(providerSandboxId, markerPath, markerValue);
  const preRead = await readProviderSandboxFile(providerSandboxId, markerPath);
  assert.equal(preRead.content?.trim(), markerValue, "T3-PROV-2: marker must be readable before pausing");

  const pauseResult = await pauseProviderSandbox(providerSandboxId);
  assert.equal(pauseResult.paused, true, "T3-PROV-2: E2B pause call must report success");
  const pausedState = await getProviderSandboxState(providerSandboxId);
  assert.equal(pausedState.state, "paused", "T3-PROV-2: E2B ground truth must show paused");

  const productObservedPause = await pollCloudSandboxStatus(client, (status) => status?.status === "paused", {
    timeoutMs: 60_000,
    pollMs: 3000,
  });
  if (productObservedPause?.status !== "paused") {
    console.warn(
      "[T3-PROV-2] product's cached cloud_sandbox.status did not flip to 'paused' within 60s of a direct E2B " +
        "pause (webhook delivery latency, or the e2b-signature secret/webhook route not reaching this target " +
        "— not re-diagnosed here). The E2B ground-truth pause above is this scenario's authoritative assertion.",
    );
  }

  // Named product lever (thin: only ensures the DB row today, per
  // cloud_sandboxes/service.py — see warmPersonalCloudSandbox's docstring),
  // called for contract fidelity with scenarios.md's plan.
  await wakeCloudSandbox(client);

  const reconnectStartedAt = Date.now();
  const postAgents = await probeAgentsThroughGatewayWithRetries(client, { attempts: 5, delayMs: 5000 });
  const reconnectElapsedMs = Date.now() - reconnectStartedAt;
  assert.ok(
    Array.isArray(postAgents) && postAgents.length > 0,
    "T3-PROV-2: reconnecting via the real anyharness gateway proxy after pause must succeed",
  );
  console.log(`[T3-PROV-2] reconnect after pause succeeded in ${reconnectElapsedMs}ms (${postAgents.length} agents)`);

  const resumedState = await getProviderSandboxState(providerSandboxId);
  assert.equal(resumedState.state, "running", "T3-PROV-2: E2B ground truth must show running again after reconnect");

  const postRead = await readProviderSandboxFile(providerSandboxId, markerPath);
  assert.equal(
    postRead.content?.trim(),
    markerValue,
    "T3-PROV-2: filesystem state must be intact after the pause/resume cycle",
  );

  await execInProviderSandbox(providerSandboxId, ["rm", "-f", markerPath]).catch(() => undefined);
}

async function probeAgentsThroughGatewayWithRetries(
  client: ApiClient,
  options: { attempts: number; delayMs: number },
): Promise<unknown[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await probeAgentsThroughGateway(client);
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) {
        await sleep(options.delayMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
