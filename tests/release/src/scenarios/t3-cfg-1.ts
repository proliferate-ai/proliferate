import assert from "node:assert/strict";

import type {
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioPlanStep,
} from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import type { PlannedCellV1 } from "../runner/result.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient, LocalRuntimeError } from "../fixtures/local-runtime.js";
import { catalogHarnesses, chatCellSpecs, withGatewayProbedCandidates } from "./t3-chat-1.js";
import { collectLocal4ConfigCells } from "./local/config-session.js";
import { isWorldBackedRun } from "./local/world-boot.js";

/**
 * T3-CFG-1 — live config options apply in an existing session.
 * specs/developing/testing/scenarios.md#T3-CFG-1 (legacy diagnostic) and
 * specs/developing/testing/tier-3-scenario-contract.md#local-4 (LOCAL-4).
 *
 * ── Leaf → matrix promotion (BRIEF §1a, disclosed) ──────────────────────────
 * This scenario was a leaf. It is now a MATRIX (one cell per catalog harness
 * kind, fanned out from `ctx.agents` via `t3-chat-1`'s `chatCellSpecs`) so the
 * green LOCAL-4 cells can carry `local_config_matrix` evidence — a leaf `run()`
 * returns void and cannot attach evidence. The id is unchanged, so the runner's
 * exact-set registry stays green.
 *
 * Two branches share the one scenario object, selected by run shape:
 *   - WORLD-BACKED (candidate map supplied → `isWorldBackedRun`): the LOCAL-4
 *     collector drives the config matrix through the product UI against a fresh
 *     candidate world (config-session workstream). Cursor → typed unsupported.
 *   - DIAGNOSTIC (no candidate map): the legacy claude-only, API-driven config
 *     round-trip is preserved verbatim for the representative claude cell; any
 *     other planned harness cell is a clean `blocked` (the legacy path only ever
 *     covered claude). Options are enumerated at runtime from
 *     `GET /v1/sessions/{id}/live-config`'s `normalizedControls`.
 *
 * `requiredEnv` stays empty so the legacy diagnostic path (which runs against a
 * pre-running local runtime, no LiteLLM) is not gated; the world-backed path
 * reads the LiteLLM env through `resolveWorldConstructionInputs` and fails clean
 * if it is absent.
 */
export const CFG_REPRESENTATIVE_HARNESS = "claude";

export const t3Cfg1: MatrixScenarioDefinition = {
  id: "T3-CFG-1",
  title: "live config options apply in an existing session",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CFG-1",
  lanes: ["local"],
  requiredEnv: [],
  kind: "matrix",
  expandCells: ({ agents }) => chatCellSpecs(agents) as ScenarioCellSpec[] | Promise<ScenarioCellSpec[]>,
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => {
    const harness = cell.dimensions.harness;
    return [
      { description: `[${harness}] create a session and complete one cheap baseline turn (config only after a real turn)` },
      { description: `[${harness}] enumerate the session's live-probe controls (GET live-config normalizedControls)` },
      { description: `[${harness}] for each settable control: select a value through the product UI, wait past the rejection window, read back` },
      { description: `[${harness}] assert accepted values stick and a rejected value restores the last-accepted (green), tracking #1063 rejections expected-fail` },
    ];
  },
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    if (isWorldBackedRun(ctx)) {
      return collectLocal4ConfigCells(ctx, cells);
    }
    return runLegacyDiagnostic(cells);
  },
};

/**
 * Diagnostic (no candidate world) path: preserves the legacy claude-only config
 * round-trip for the representative claude cell and cleanly blocks any other
 * planned harness cell — the legacy path never covered them.
 */
async function runLegacyDiagnostic(cells: readonly PlannedCellV1[]): Promise<ScenarioCellOutcome[]> {
  const outcomes: ScenarioCellOutcome[] = [];
  for (const cell of cells) {
    if (cell.dimensions.harness !== CFG_REPRESENTATIVE_HARNESS) {
      outcomes.push({
        cellId: cell.cell_id,
        status: "blocked",
        reason: {
          code: "scenario_blocked",
          message:
            `[${cell.dimensions.harness}] the T3-CFG-1 diagnostic path covers the representative claude harness only; ` +
            "the full per-harness LOCAL-4 config matrix requires the candidate world",
        },
      });
      continue;
    }
    try {
      await runLegacyClaudeCycle();
      outcomes.push({ cellId: cell.cell_id, status: "green" });
    } catch (error) {
      if (error instanceof ScenarioExpectedFailError) {
        outcomes.push({ cellId: cell.cell_id, status: "expected_fail", reason: { code: "known_gap", message: error.diagnosis } });
      } else {
        outcomes.push({
          cellId: cell.cell_id,
          status: "failed",
          reason: { code: "scenario_failure", message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }
  return outcomes;
}

/**
 * The legacy claude-only config round-trip (verbatim), against a pre-running
 * local runtime. Throws `ScenarioExpectedFailError` on the #1063 menu/apply
 * mismatch; returns normally on success.
 */
async function runLegacyClaudeCycle(): Promise<void> {
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
 * ranked catalog candidates (same source as T3-CHAT-1) and tries each until the
 * runtime accepts one.
 */
async function createClaudeSession(
  client: LocalRuntimeClient,
  workspaceId: string,
): Promise<{ id: string }> {
  const choice = (await catalogHarnesses(["claude"])).get("claude");
  const candidates = await withGatewayProbedCandidates(client, "claude", choice?.modelCandidates ?? []);
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
