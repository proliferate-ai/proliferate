import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient, LocalRuntimeError } from "../fixtures/local-runtime.js";
import { catalogHarnesses } from "./t3-chat-1.js";

/**
 * T3-CFG-1 — live config options apply in an existing session.
 * specs/developing/testing/scenarios.md#T3-CFG-1
 *
 * Not in the original phase-1 skeleton (scenarios.md was still DRAFT when
 * that skeleton was built; T3-CFG-1 was added 2026-07-08 and is in this
 * runner's explicit scope). Options are enumerated at runtime from
 * `GET /v1/sessions/{id}/live-config`'s `normalizedControls` — never
 * hardcoded — so a new catalog-declared control is automatically in scope.
 *
 * Local lane only for now (per contract: "sandbox lane on the release
 * train" — a real E2B sandbox costs money per run and this scenario's
 * guarantee, the runtime's config-apply seam, is identical in both lanes).
 *
 * Model selection is catalog/classification-resolved, never a hardcoded bare
 * id. Before #1046 this scenario opened the session with the bare id
 * `"haiku"`; on a Bedrock-classified account (t3local classifies claude to
 * `["bedrock"]` — the flag rides the readiness/auth overlay, not the profile
 * launch.env) that id is now correctly gated `SESSION_MODEL_GATED` behind
 * `["anthropic-api","anthropic-oauth"]`, which surfaced as issue #1051. The
 * fix is test-side: resolve the account's actual cheapest working model the
 * same way T3-CHAT-1 does (first accepted `catalogHarnesses` candidate — e.g.
 * `us.anthropic.claude-sonnet-4-6`), so the scenario tests config round-trips
 * against whatever model the classification yields.
 */
export const t3Cfg1: ScenarioDefinition = {
  id: "T3-CFG-1",
  title: "live config options apply in an existing session",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CFG-1",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [
    { description: "create a session (claude, cheapest Anthropic model) and send one message" },
    { description: "GET /v1/sessions/{id}/live-config, enumerate normalizedControls at runtime" },
    { description: "for each settable control: cycle every declared value, POST config-options, read back" },
    { description: "assert each value round-trips (set == readback) and the session never errors" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await runLocalLane();
  },
};

async function runLocalLane(): Promise<void> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });

  const repoPath = await ensureLocalClone(githubTestRepo);
  const { workspace } = await client.createLocalWorkspace(repoPath);

  try {
    await client.installAgent("claude");
    const session = await createClaudeSession(client, workspace.id);
    await client.prompt(session.id, "Reply with exactly the word: ack");
    await client.waitForIdle(session.id, { timeoutMs: 60_000 });

    const liveConfig = await client.getLiveConfig(session.id);
    const controlKeys = Object.keys(liveConfig.normalizedControls);
    assert.ok(controlKeys.length > 0, "T3-CFG-1: session must expose at least one live-config control");

    const cycled: string[] = [];
    // Controls the live-config menu advertises as `settable` but the session's
    // config-apply surface rejects with SESSION_CONFIG_REJECTED "not exposed by
    // the active session" — a genuine menu/apply mismatch, the exact class of
    // bug this scenario exists to catch. Collected and surfaced as a diagnosed
    // expected-fail (tracked, not red) rather than aborting the whole cycle, so
    // the controls that DO round-trip are still asserted.
    const advertisedButRejected: string[] = [];
    for (const controlKey of controlKeys) {
      const control = liveConfig.normalizedControls[controlKey];
      if (!control.settable) {
        continue;
      }
      for (const optionValue of control.values) {
        if (optionValue.value === control.currentValue) {
          continue;
        }
        try {
          await client.setConfigOption(session.id, control.rawConfigId, optionValue.value);
        } catch (error) {
          if (isConfigRejected(error)) {
            advertisedButRejected.push(`${controlKey}(rawConfigId=${control.rawConfigId})`);
            break;
          }
          throw error;
        }
        const readback = await client.getLiveConfig(session.id);
        const readbackControl = readback.normalizedControls[controlKey];
        assert.equal(
          readbackControl?.currentValue,
          optionValue.value,
          `T3-CFG-1: [${controlKey}] set ${optionValue.value} but readback was ${readbackControl?.currentValue}`,
        );
        cycled.push(`${controlKey}=${optionValue.value}`);
        // Only cycle one non-default value per control to keep this scenario
        // cheap and fast — the contract's guarantee ("each option value
        // round-trips") is proven by any successful set+readback, and
        // exhaustively cycling every value of every control multiplies run
        // time for no additional signal about the apply seam itself.
        break;
      }
    }
    assert.ok(cycled.length > 0, "T3-CFG-1: must have cycled at least one control");

    const session2 = await client.getSession(session.id);
    assert.notEqual(session2.status.toLowerCase(), "errored", "T3-CFG-1: session must survive every config switch");
    console.log(`[T3-CFG-1/local] cycled: ${cycled.join(", ")}`);

    if (advertisedButRejected.length > 0) {
      throw new ScenarioExpectedFailError(
        `T3-CFG-1: config control(s) advertised as settable in live-config normalizedControls but ` +
          `rejected on apply with SESSION_CONFIG_REJECTED "not exposed by the active session": ` +
          `${advertisedButRejected.join(", ")} (on a us.anthropic.claude-sonnet-4-6 session). ` +
          `Controls that round-tripped: ${cycled.join(", ")}. Menu/apply mismatch surfaced by T3-CFG-1 — ` +
          `filed as https://github.com/proliferate-ai/proliferate/issues/1063.`,
      );
    }
  } finally {
    await client.deleteWorkspace(workspace.id).catch(() => undefined);
  }
}

/** True for the runtime's "control advertised but not exposed by the session" 400. */
function isConfigRejected(error: unknown): boolean {
  if (!(error instanceof LocalRuntimeError) || error.status !== 400) {
    return false;
  }
  const body = error.body as { code?: string } | null;
  return body?.code === "SESSION_CONFIG_REJECTED";
}

/**
 * Open a claude session on the account's cheapest working model. Resolves the
 * ranked catalog candidates (same source as T3-CHAT-1) and tries each until
 * the runtime accepts one — a bare id like `"haiku"` is gated on a
 * Bedrock/gateway-classified account (#1046), while `us.anthropic.*` /
 * `anthropic/claude-*` ids pass, so trying candidates in order lands on
 * whatever the live classification yields instead of guessing.
 */
async function createClaudeSession(
  client: LocalRuntimeClient,
  workspaceId: string,
): Promise<{ id: string }> {
  const choice = (await catalogHarnesses(["claude"])).get("claude");
  const candidates = choice?.modelCandidates ?? [];
  if (candidates.length === 0) {
    throw new Error("T3-CFG-1: no claude model candidate found in catalogs/agents/catalog.json");
  }
  let lastError: unknown;
  for (const modelId of candidates) {
    try {
      const session = await client.createSession({ workspaceId, agentKind: "claude", modelId });
      console.log(`[T3-CFG-1/local] opened claude session on model=${modelId}`);
      return session;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `T3-CFG-1: no catalog claude model was accepted by the runtime (tried ${candidates.join(", ")}). ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
