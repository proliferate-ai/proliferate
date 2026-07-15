import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import { withGatewayProbedCandidates } from "./t3-chat-1.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { pushGatewayAuthState } from "../fixtures/agent-auth.js";
import {
  LocalRuntimeClient,
  findErrorEvent,
  findLastAssistantReply,
  findTurnEndedEvent,
} from "../fixtures/local-runtime.js";

/**
 * T3-GW-1 — model gateway: the REAL product path (workspace → session → streamed
 * turn) through the gateway, with no workspace-env credential injection.
 * specs/developing/testing/flows.md (Self-hosting) / #1106
 *
 * This SUPPLEMENTS T3-SH-3, which asserts only a direct LiteLLM
 * `/v1/chat/completions` call against the standing box. A direct completion
 * proves the gateway *serves a model*; it does NOT prove the shipped product
 * path — agent readiness, session creation, and a real streamed turn — works
 * over the gateway. This scenario drives exactly that against the local
 * AnyHarness runtime (the same runtime a cloud sandbox / desktop embeds):
 *
 *  1. Enroll a gateway route by pushing ONLY `agent-auth/state.json`
 *     (`PUT /v1/agent-auth/state`). No `ANTHROPIC_*` / `OPENAI_*` credential is
 *     written into any workspace/session/global env file — this is the exact
 *     shape a real client (desktop dispatch worker / cloud materialization
 *     worker) delivers. Before the #1106 readiness fix, step 3 failed with
 *     `agent '<kind>' is not ready (LoginRequired)` and operators worked around
 *     it by copying the gateway credentials into a workspace env file.
 *  2. Create a local workspace over the disposable fixture repo.
 *  3. For claude AND codex: install the agent, then `POST /v1/sessions`
 *     immediately after the route push — the session-create readiness gate must
 *     PASS (issue #1106), with NO env-injection workaround and NO client-side
 *     agent-auth polling.
 *  4. Assert the session resolved a concrete gateway model id (never a bare
 *     native selector like `default`/`sonnet`) — the eligibility guarantee that
 *     the picker/API never hand LiteLLM a model it cannot serve. (The negative
 *     "`default` is gated" half is pinned deterministically at the unit layer,
 *     `catalog::service_tests::gateway_context_gates_native_ids_and_offers_only_gateway_models`,
 *     because whether it is *offered* depends on the runtime's ambient env; the
 *     real path here proves the *positive* — a gateway-eligible model launches
 *     and completes.)
 *  5. Send a prompt and assert a real streamed turn completes: `turn_ended`
 *     observed, a non-empty assistant reply, and no session `error` event — the
 *     no-mock-LLM, outcome-not-transcript assertion. A native selector reaching
 *     LiteLLM would surface here as a 400 `error` event, not a hang.
 *
 * Lane: local runtime only. The full product-API path against a self-hosted or
 * staging server (admin login → server-mediated session → sandbox runtime) is
 * the same slice T3-CHAT-1's sandbox lane leaves unimplemented (#1042) — it
 * needs a running durable sandbox and a publicly reachable callback URL. This
 * scenario deliberately stays on the local runtime, which exercises the exact
 * Rust readiness/eligibility code paths the fix touches.
 *
 * Env: RELEASE_E2E_GATEWAY_TEST_KEY + RELEASE_E2E_GATEWAY_BASE_URL are required
 * (the gateway virtual key and its public inference base URL). A reachable local
 * AnyHarness runtime is required too — BLOCKED (not red) when it is absent, so a
 * credential-less or runtime-less environment reports the gap instead of failing
 * the gate.
 */

/**
 * Catalog gateway-eligible ids per harness (availability: ["gateway"]),
 * cheapest-first — the fallback when the runtime has not probed the gateway yet
 * (`getGatewayModels` returns the catalog seed list in that case, which the
 * probed-candidates helper prefers automatically). Kept small and cheap: the
 * gateway test key is allowlisted to the cheap test-model set.
 */
const GATEWAY_MODEL_CANDIDATES: Record<string, string[]> = {
  claude: ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
  codex: ["gpt-5-mini", "gpt-5-mini-2025-08-07", "gpt-5.2"],
};

const GATEWAY_HARNESSES = ["claude", "codex"] as const;

export const t3Gw1: ScenarioDefinition = {
  id: "T3-GW-1",
  title: "model gateway: real workspace → session → streamed turn, no env injection",
  registryFlowRef: "specs/developing/testing/flows.md#self-hosting",
  lanes: ["local"],
  requiredEnv: ["RELEASE_E2E_GATEWAY_TEST_KEY", "RELEASE_E2E_GATEWAY_BASE_URL"],
  plan: () =>
    GATEWAY_HARNESSES.flatMap((harness) => [
      { description: `push a gateway-only agent-auth state (no workspace env credential)` },
      { description: `[${harness}] install agent, then create a session immediately after the route push (issue #1106 readiness gate must pass)` },
      { description: `[${harness}] assert the session resolved a concrete gateway model id (not a bare native selector)` },
      { description: `[${harness}] send a prompt, await turn_ended, assert a non-empty reply and no error (real streamed turn through the gateway)` },
    ]),
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
    const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });

    // Reachability: this is release-validation infra, not a product bug —
    // report BLOCKED rather than red when no local runtime is up.
    try {
      await client.listAgents();
    } catch (error) {
      throw new ScenarioBlockedError(
        `T3-GW-1: local AnyHarness runtime not reachable at ${runtimeUrl} ` +
          `(${error instanceof Error ? error.message : String(error)}). Start a local ` +
          `runtime (make run PROFILE=<name>) or set RELEASE_E2E_LOCAL_RUNTIME_URL.`,
      );
    }

    const gatewayKey = ctx.env.require("RELEASE_E2E_GATEWAY_TEST_KEY");
    const gatewayBaseUrl = ctx.env.require("RELEASE_E2E_GATEWAY_BASE_URL");

    // Enroll the gateway route the way a real client does: push state.json, and
    // NOTHING into any workspace env. This is the exact condition #1106 broke.
    await pushGatewayAuthState({ runtimeUrl, gatewayBaseUrl, gatewayKey });

    const repoPath = await ensureLocalClone(
      process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO,
    );
    const { workspace } = await client.createLocalWorkspace(repoPath);

    const results: Array<{ harness: string; model: string }> = [];
    try {
      for (const harness of GATEWAY_HARNESSES) {
        results.push(await runGatewayHarness(client, workspace.id, harness));
      }
    } finally {
      await client.deleteWorkspace(workspace.id).catch(() => undefined);
    }

    console.log("[T3-GW-1] real gateway product path verified (no env injection):");
    for (const result of results) {
      console.log(`  - ${result.harness}: streamed turn completed on gateway model ${result.model}`);
    }
  },
};

async function runGatewayHarness(
  client: LocalRuntimeClient,
  workspaceId: string,
  harness: string,
): Promise<{ harness: string; model: string }> {
  await client.installAgent(harness);

  // Prefer the runtime's own probed/seed gateway list (what the pushed key can
  // actually serve), falling back to the catalog gateway ids — all of which are
  // concrete gateway model ids, never bare native selectors.
  const candidates = await withGatewayProbedCandidates(
    client,
    harness,
    GATEWAY_MODEL_CANDIDATES[harness] ?? [],
  );
  assert.ok(candidates.length > 0, `[${harness}] no gateway model candidates resolved`);

  // #1106: create the session immediately after the route push, with the
  // credential living ONLY in state.json. The readiness gate must pass.
  let session: Awaited<ReturnType<LocalRuntimeClient["createSession"]>> | undefined;
  let usedModel: string | undefined;
  let lastError: unknown;
  for (const modelId of candidates) {
    try {
      session = await client.createSession({ workspaceId, agentKind: harness, modelId });
      usedModel = modelId;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  assert.ok(
    session && usedModel,
    `[${harness}] create session through the gateway route failed (issue #1106 regression?): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );

  // Eligibility (positive): the session resolved a concrete gateway model id,
  // never a bare native selector that LiteLLM would 400.
  const resolvedModel = session.modelId ?? session.requestedModelId ?? usedModel;
  assert.ok(
    !BARE_NATIVE_SELECTORS.has(resolvedModel),
    `[${harness}] session resolved a bare native selector (${resolvedModel}) on a gateway route — it would 400 at LiteLLM`,
  );

  // Real streamed turn through the gateway.
  await client.prompt(session.id, "Reply with exactly the word: pong");
  await client.waitForIdle(session.id, { timeoutMs: 90_000 });
  const events = await client.getEvents(session.id);
  const errorMessage = findErrorEvent(events);
  assert.equal(
    errorMessage,
    undefined,
    `[${harness}] gateway turn errored (a native selector reaching LiteLLM shows up here): ${errorMessage}`,
  );
  assert.ok(findTurnEndedEvent(events), `[${harness}] turn_ended event must be observed`);
  const reply = findLastAssistantReply(events);
  assert.ok(
    reply && reply.trim().length > 0,
    `[${harness}] must produce a non-empty assistant reply through the gateway`,
  );

  return { harness, model: usedModel };
}

/** Bare native CLI selectors that are gateway-ineligible in the catalog. */
const BARE_NATIVE_SELECTORS = new Set(["default", "sonnet", "opus", "haiku", "gpt-5.5"]);
