import type {
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioPlanStep,
} from "./types.js";
import type { PlannedCellV1 } from "../runner/result.js";
import { collectLocal5SessionTabsCell } from "./local/config-session.js";

/**
 * T3-SESSION-1 — session and tab semantics (LOCAL-5), on the merged PR-1 local
 * world. Owner: config-session.
 *
 * NEW canonical scenario, `lanes: ["local"]` only, world-required. It is a
 * MATRIX scenario with a SINGLE cell (dimension `harness=claude`, the starting
 * harness) rather than a leaf, because only a matrix collector can attach the
 * green cell's `local_session_tabs` evidence — a leaf `run()` returns void and
 * cannot carry evidence. Registered exactly once in `registry.ts`.
 */
export const SESSION_TABS_START_HARNESS = "claude";

export const t3Session1: MatrixScenarioDefinition = {
  id: "T3-SESSION-1",
  title: "session and tab semantics in one workspace (LOCAL-5)",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#local-5",
  lanes: ["local"],
  requiredEnv: [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ],
  kind: "matrix",
  expandCells: (): ScenarioCellSpec[] => [{ dimensions: { harness: SESSION_TABS_START_HARNESS } }],
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => [
    { description: `[${cell.cell_id}] switch after messages preserves the old transcript, opens a new (genuinely empty) tab to its right` },
    { description: `[${cell.cell_id}] empty-chat harness switch on that new tab replaces the backend session in place (same tab position, id changes)` },
    { description: `[${cell.cell_id}] same-harness model change stays in-session where the harness contract permits` },
    { description: `[${cell.cell_id}] reload preserves tab order, active tab, harness attachment, and transcript` },
  ],
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    const outcomes: ScenarioCellOutcome[] = [];
    for (const cell of cells) {
      outcomes.push(await collectLocal5SessionTabsCell(ctx, cell));
    }
    return outcomes;
  },
};
