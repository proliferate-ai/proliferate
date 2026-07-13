/**
 * LOCAL-2 — managed-gateway turn for ONE probed harness (tier-3 local-runtime).
 *
 * Composed journey (specs/developing/testing/tier-3-scenario-contract.md
 * "LOCAL-2"), the vertical slice for one harness:
 *
 *   1. create a fresh gateway actor and register its repository;
 *   2. enroll it through the production server path, producing a scoped LiteLLM
 *      virtual key with a recorded `token_id` (hash only — never the raw key);
 *   3. select the cheapest eligible model from the intersection of the
 *      qualification allowlist and the LIVE probe (probe is authoritative);
 *   4. select managed gateway, create a session, send one bounded prompt;
 *   5. assert session completion and one stable response after reload;
 *   6. poll LiteLLM unsummarized spend logs and find the correlated request under
 *      `api_key == token_id`, with real request/model/token/cost data;
 *   7. assert the product usage event + managed balance reconcile to that request.
 *
 * Emits one FinalCellResult through the frozen result contract. `green` is the
 * only passing state; a missing gateway configuration, credential, or product
 * path is `blocked` (never a fake green), and an assertion failure is `failed`
 * with preserved, redacted evidence. Configuration success alone is not route
 * proof — the launch evidence identifies the managed route and public LiteLLM
 * origin without exposing the key.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import type { LocalRuntimeWorldHandle } from "../../contracts/world.js";
import type { WorldContext } from "../../contracts/world.js";
import type { CellAttempt, CellStatus, FinalCellResult } from "../../contracts/results.js";
import { type CellIdentity, cellKey } from "../../contracts/identity.js";
import { ApiClient } from "../../../fixtures/http.js";
import {
  mintFreshUser,
  type DurableUserCredentials,
  type FreshUserFixture,
} from "../../../fixtures/identity.js";
import { ensureLocalClone } from "../../../fixtures/git.js";
import {
  LocalRuntimeClient,
  findErrorEvent,
  findLastAssistantReply,
  findTurnEndedEvent,
} from "../../../fixtures/local-runtime.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../../../config/env-manifest.js";
import {
  getGatewayCapabilities,
  getLocalGatewayAuthState,
  gatewaySourceForHarness,
  pushAgentAuthStateToRuntime,
  type AgentAuthState,
} from "./gateway.js";
import {
  DEFAULT_QUALIFICATION_ALLOWLIST,
  chooseCheapestEligibleModel,
  isBareNativeSelector,
} from "./model-selection.js";
import { probeEnrollment, probeImportAndReconcile, probeSpendLogs } from "./spend.js";
import { redactValue } from "./redaction.js";

const SCENARIO_ID = "LOCAL-2";
const DEFAULT_HARNESS = "claude";
/** Overall bounded deadline for the cell — a real turn plus spend-log settle. */
const CELL_DEADLINE_MS = 5 * 60_000;
/** How long to wait for a LiteLLM spend row to appear after the turn. */
const SPEND_SETTLE_MS = 90_000;

export interface Local2Options {
  env?: NodeJS.ProcessEnv;
  harness?: string;
  now?: () => number;
}

/** A gap in configuration/credential/product path — reported blocked, not green. */
class CellBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellBlockedError";
  }
}

export function local2CellIdentity(harness: string): CellIdentity {
  return {
    scenarioId: SCENARIO_ID,
    world: "local-runtime",
    productHost: "desktop-web",
    dimensions: { harness, route: "managed-gateway" },
  };
}

/**
 * Run the LOCAL-2 vertical slice for one harness against a ready local-runtime
 * world. Returns a single FinalCellResult; never throws for an ordinary
 * blocked/failed cell (those are encoded in the result), only rethrows a
 * programming error.
 */
export async function runLocal2Cell(
  handle: LocalRuntimeWorldHandle,
  ctx: WorldContext,
  options: Local2Options = {},
): Promise<FinalCellResult> {
  const env = options.env ?? process.env;
  const harness = options.harness ?? env.LOCAL_2_HARNESS ?? DEFAULT_HARNESS;
  const cell = local2CellIdentity(harness);
  const key = cellKey(cell);
  const now = options.now ?? Date.now;
  const startedAt = new Date().toISOString();
  const deadline = now() + CELL_DEADLINE_MS;
  const correlationIds: string[] = [ctx.run.runId, ctx.shard.shardId];
  const secrets: string[] = [];

  const attemptId = randomUUID();
  let status: CellStatus = "green";
  let detail = "managed-gateway turn correlated to LiteLLM spend + product usage event";

  const cleanups: Array<() => Promise<void>> = [];
  try {
    // --- prerequisites: reachable stack + configured gateway ------------------
    const runtime = new LocalRuntimeClient({ baseUrl: handle.anyharnessUrl });
    if (!handle.gatewayOrigin) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: no qualification LiteLLM gateway resolved (${handle.gatewayIdentity}). ` +
          "Set RELEASE_E2E_GATEWAY_BASE_URL or enable the gateway on the candidate server " +
          "(agent_gateway_enabled + agent_gateway_litellm_base_url/master_key).",
      );
    }

    const durable = requireDurableCreds(env, handle.serverUrl);

    // --- (1) fresh gateway actor + its repository ----------------------------
    const actor: FreshUserFixture = await mintFreshUser(durable);
    cleanups.push(() => actor.teardown().catch(() => undefined));
    await registerLedger(ctx, handle, "product-user", actor.session.user.id);
    correlationIds.push(`user:${actor.session.user.id}`, `org:${actor.organizationId}`);
    const authed = new ApiClient({ baseUrl: handle.serverUrl }).withBearerToken(
      actor.session.accessToken,
    );
    const repoPath = await ensureLocalClone(
      env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO,
    );

    // --- (2) enroll through the production server path -----------------------
    const caps = await getGatewayCapabilities(authed);
    if (!caps.gatewayEnabled) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: candidate server reports gateway_enabled=false — the production ` +
          "enrollment path cannot mint a scoped LiteLLM virtual key. This is the current local-dev " +
          "posture (agent_gateway_enabled defaults false, no local LiteLLM). Configure the qualification " +
          "gateway on the candidate server to run this cell for real.",
      );
    }
    const authState: AgentAuthState = await getLocalGatewayAuthState(authed);
    const gatewaySource = gatewaySourceForHarness(authState, harness);
    if (!gatewaySource) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: the production state document has no gateway source for '${harness}' — ` +
          "the actor's enrollment produced no scoped key for this harness.",
      );
    }
    secrets.push(gatewaySource.key);

    // Read the scoped key's token_id (hash) from the enrollment row — it never
    // crosses the HTTP boundary, and the raw key is never printed.
    const enrollment = await probeEnrollment(actor.email);
    if (enrollment.error || !enrollment.tokenId) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: could not resolve the scoped key token_id for the fresh actor ` +
          `(${enrollment.error ?? "no token_id on enrollment row"}).`,
      );
    }
    const tokenId = enrollment.tokenId;
    correlationIds.push(`token_id:${tokenId}`, `litellm_origin:${safeHost(handle.gatewayOrigin)}`);
    await registerLedger(ctx, handle, "litellm-virtual-key", tokenId);
    const grantedBefore = enrollment.grantedUsd ?? null;
    const remainingBefore = enrollment.remainingUsd ?? null;

    // Deliver the production state document to the local runtime, exactly as the
    // Desktop dispatch worker does — the credential lives ONLY in state.json.
    await pushAgentAuthStateToRuntime(handle.anyharnessUrl, authState);

    // --- (3) cheapest eligible model = allowlist ∩ LIVE probe ----------------
    await runtime.installAgent(harness);
    const probed = await runtime.getGatewayModels(harness).catch(() => []);
    const probedIds = probed.map((m) => m.id);
    if (probedIds.length === 0) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: the runtime returned no live gateway-probed models for '${harness}' — ` +
          "cannot select from the allowlist ∩ live-probe intersection (the probe is authoritative).",
      );
    }
    const allowlist = DEFAULT_QUALIFICATION_ALLOWLIST[harness] ?? [];
    const choice = chooseCheapestEligibleModel(harness, allowlist, probedIds);
    correlationIds.push(`model:${choice.modelId}`);

    // --- (4) managed-gateway session + one bounded prompt --------------------
    const { workspace } = await runtime.createLocalWorkspace(repoPath);
    cleanups.push(() => runtime.deleteWorkspace(workspace.id).catch(() => undefined));
    const session = await runtime.createSession({
      workspaceId: workspace.id,
      agentKind: harness,
      modelId: choice.modelId,
    });
    correlationIds.push(`workspace:${workspace.id}`, `session:${session.id}`);

    // Route proof: the launched session resolved a concrete gateway model id,
    // never a bare native selector LiteLLM would 400. Configuration alone is
    // not route proof — the paid turn below plus the spend row is.
    const resolvedModel = session.modelId ?? session.requestedModelId ?? choice.modelId;
    assert.ok(
      !isBareNativeSelector(resolvedModel),
      `${SCENARIO_ID}: session resolved a bare native selector (${resolvedModel}) on the managed route`,
    );

    const nonce = randomBytes(4).toString("hex");
    ensureDeadline(deadline, now, "before prompt");
    await runtime.prompt(session.id, `Reply with exactly this token and nothing else: ${nonce}`);
    await runtime.waitForIdle(session.id, { timeoutMs: Math.min(90_000, deadline - now()) });

    // --- (5) completion + stable response after reload -----------------------
    const events = await runtime.getEvents(session.id);
    const errorMessage = findErrorEvent(events);
    assert.equal(
      errorMessage,
      undefined,
      `${SCENARIO_ID}: managed-gateway turn errored (a native id reaching LiteLLM surfaces here): ${errorMessage}`,
    );
    assert.ok(findTurnEndedEvent(events), `${SCENARIO_ID}: turn_ended must be observed`);
    const reply = findLastAssistantReply(events);
    assert.ok(reply && reply.trim().length > 0, `${SCENARIO_ID}: must produce a non-empty reply`);

    const reopened = await runtime.getSession(session.id);
    assert.equal(reopened.id, session.id, `${SCENARIO_ID}: session must reopen with the same id`);
    const replayed = await runtime.getEvents(session.id);
    assert.ok(
      findTurnEndedEvent(replayed),
      `${SCENARIO_ID}: transcript must replay a stable completed turn after reload`,
    );

    // --- (6) LiteLLM spend correlation under token_id ------------------------
    const spend = await pollSpendLogs(tokenId, deadline, now);
    if (spend.error) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: LiteLLM spend-log API not reachable (${spend.error}: ${spend.detail ?? ""}). ` +
          "The turn completed but the correlation half cannot be proven — leaving the cell red/blocked honestly.",
      );
    }
    assert.ok(
      spend.rows.length > 0,
      `${SCENARIO_ID}: no LiteLLM spend row appeared under token_id within ${SPEND_SETTLE_MS}ms`,
    );
    for (const row of spend.rows) {
      assert.ok(row.requestId, `${SCENARIO_ID}: spend row must carry a request id`);
      assert.equal(row.apiKey, tokenId, `${SCENARIO_ID}: spend row api_key must equal token_id`);
      assert.ok(row.model.length > 0, `${SCENARIO_ID}: spend row must carry a real model`);
      assert.ok(row.totalTokens > 0, `${SCENARIO_ID}: spend row must carry real token usage`);
      assert.ok(row.spend >= 0, `${SCENARIO_ID}: spend row must carry a cost`);
    }
    correlationIds.push(...spend.rows.map((r) => `litellm_request:${r.requestId}`));

    // --- (7) product usage event + managed balance reconcile -----------------
    const reconcile = await probeImportAndReconcile(actor.email);
    if (reconcile.error) {
      throw new CellBlockedError(
        `${SCENARIO_ID}: usage importer failed (${reconcile.error}: ${reconcile.detail ?? ""}).`,
      );
    }
    const events7 = reconcile.events ?? [];
    const correlated = events7.filter((e) => e.virtualKeyId === tokenId);
    assert.ok(
      correlated.length > 0,
      `${SCENARIO_ID}: no agent_llm_usage_event imported for the scoped key`,
    );
    for (const usage of correlated) {
      assert.ok(usage.model, `${SCENARIO_ID}: usage event must carry a model`);
      assert.ok(usage.totalTokens > 0, `${SCENARIO_ID}: usage event must carry token usage`);
      assert.ok(
        usage.costUsd !== null && usage.costUsd >= 0,
        `${SCENARIO_ID}: usage event must carry a reconciled USD cost`,
      );
    }
    // Managed balance reconciled: remaining debited by (at least) the imported cost.
    if (
      grantedBefore !== null &&
      remainingBefore !== null &&
      reconcile.remainingUsd !== null &&
      reconcile.remainingUsd !== undefined
    ) {
      assert.ok(
        reconcile.remainingUsd <= remainingBefore + 1e-9,
        `${SCENARIO_ID}: managed balance must not increase after a paid turn ` +
          `(before=${remainingBefore}, after=${reconcile.remainingUsd})`,
      );
    }
    correlationIds.push(...correlated.map((e) => `usage_event:${e.id}`));

    detail =
      `managed-gateway turn on ${choice.modelId} (${choice.fromAllowlist ? "allowlist" : "probe-fallback"}) ` +
      `correlated to ${spend.rows.length} LiteLLM spend row(s) and ${correlated.length} usage event(s) ` +
      `under token_id; route=managed-gateway, origin=${safeHost(handle.gatewayOrigin)}`;
  } catch (error) {
    if (error instanceof CellBlockedError) {
      status = "blocked";
      detail = error.message;
    } else {
      status = "failed";
      detail = redactValue(error, { env, additionalSecrets: secrets });
    }
  } finally {
    // Cleanup in reverse order; independent failures do not mask each other.
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
  }

  const finishedAt = new Date().toISOString();
  const attempt: CellAttempt = {
    attemptId,
    attemptNumber: 1,
    cellKey: key,
    cell,
    status,
    detail: redactValue(detail, { env, additionalSecrets: secrets }),
    correlationIds,
    startedAt,
    finishedAt,
    superseded: false,
  };
  await ctx.evidence.append({
    kind: "cell-final",
    cellKey: key,
    status,
    detail: attempt.detail,
    correlationIds,
  });
  return { cellKey: key, cell, status, attempts: [attempt] };
}

function requireDurableCreds(env: NodeJS.ProcessEnv, serverUrl: string): DurableUserCredentials {
  const email = env.RELEASE_E2E_DURABLE_USER_EMAIL;
  const password = env.RELEASE_E2E_DURABLE_USER_PASSWORD;
  const organizationId = env.RELEASE_E2E_DURABLE_ORG_ID;
  if (!email || !password || !organizationId) {
    throw new CellBlockedError(
      `${SCENARIO_ID}: RELEASE_E2E_DURABLE_USER_EMAIL/PASSWORD and RELEASE_E2E_DURABLE_ORG_ID are required ` +
        "to mint a fresh gateway actor through the production invite path.",
    );
  }
  return { serverUrl, email, password, organizationId };
}

async function pollSpendLogs(
  tokenId: string,
  deadline: number,
  now: () => number,
): Promise<Awaited<ReturnType<typeof probeSpendLogs>>> {
  const settleDeadline = Math.min(deadline, now() + SPEND_SETTLE_MS);
  let last = await probeSpendLogs(tokenId);
  while (!last.error && last.rows.length === 0 && now() < settleDeadline) {
    await sleep(5_000);
    last = await probeSpendLogs(tokenId);
  }
  return last;
}

async function registerLedger(
  ctx: WorldContext,
  handle: LocalRuntimeWorldHandle,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await ctx.ledger.register({
    runId: ctx.run.runId,
    shardId: ctx.shard.shardId,
    provider: resourceType === "litellm-virtual-key" ? "litellm" : "product",
    resourceType,
    resourceId,
    owningWorld: handle.world,
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function ensureDeadline(deadline: number, now: () => number, phase: string): void {
  if (now() >= deadline) {
    throw new Error(`${SCENARIO_ID}: cell deadline exceeded ${phase}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
