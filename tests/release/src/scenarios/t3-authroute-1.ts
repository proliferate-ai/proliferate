import type {
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioPlanStep,
} from "./types.js";
import type { PlannedCellV1 } from "../runner/result.js";
import { shippedHarnessKinds } from "./t3-chat-1.js";
import {
  BYOK_ENV_BY_HARNESS,
  LOCAL6_REPRESENTATIVE_HARNESS,
  collectLocal3UserKeyCells,
  collectLocal6RouteChangeCell,
} from "./local/chat-authroute.js";

/**
 * T3-AUTHROUTE-1 — user API-key route per harness (LOCAL-3) and route-change
 * semantics (LOCAL-6), on the merged PR-1 local world. Owner: chat-authroute.
 *
 * NEW canonical scenario (no legacy variant), `lanes: ["local"]` only, and it
 * REQUIRES the candidate world — a diagnostic invocation with no candidate map
 * yields a clean `blocked` per cell (see collector). Registered exactly once in
 * `registry.ts`, so registry exact-set validation stays green.
 *
 * Cells:
 *  - one `harness=<kind>` per catalog harness EXCEPT cursor (LOCAL-3, user-key);
 *  - one `route=change` cell (LOCAL-6, single representative source harness).
 */
export const ROUTE_CHANGE_DIMENSION = { route: "change" } as const;

export const t3Authroute1: MatrixScenarioDefinition = {
  id: "T3-AUTHROUTE-1",
  title: "user API-key route per harness (LOCAL-3) + route-change semantics (LOCAL-6)",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#local-3",
  lanes: ["local"],
  requiredEnv: [
    // LOCAL-6 (route-change) enrolls the gateway route and correlates spend.
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ],
  kind: "matrix",
  expandCells: async ({ agents }): Promise<ScenarioCellSpec[]> => {
    // Consume `ctx.agents` (the `t3-chat-1` fanout pattern, decision #6): an
    // explicit `--agents claude` must expand ONLY the claude user-key cell, not
    // the full catalog fanout. `all` derives the shipped harness kinds from the
    // catalog. Run-1 expanded claude+codex+grok+opencode despite AGENTS=claude
    // because this ignored the selector.
    const selected = agents.includes("all") ? await shippedHarnessKinds() : [...agents];
    const selectedKinds = new Set(selected);
    const byokEntries = Object.entries(BYOK_ENV_BY_HARNESS) as Array<[string, string]>;
    const userKeyCells: ScenarioCellSpec[] = byokEntries
      // Cursor excluded from user-key cells: its CURSOR_API_KEY is an account
      // key, not a provider key (standing program exclusion) — it has no entry
      // in BYOK_ENV_BY_HARNESS. Keep only the SELECTED harnesses (intersected
      // with the catalog's user-key-capable set).
      .filter(([kind]) => selectedKinds.has(kind))
      .map(([kind, envVar]) => ({ dimensions: { harness: kind }, requiredEnv: [envVar] }));
    // The single LOCAL-6 route-change cell is driven by the representative
    // source harness; include it whenever that harness is selected (always, for
    // `all`) so a scoped `--agents` run that excludes it does not plan an
    // unrunnable route-change cell.
    const cells = [...userKeyCells];
    if (selectedKinds.has(LOCAL6_REPRESENTATIVE_HARNESS)) {
      cells.push({
        dimensions: { ...ROUTE_CHANGE_DIMENSION },
        requiredEnv: [BYOK_ENV_BY_HARNESS[LOCAL6_REPRESENTATIVE_HARNESS]],
      });
    }
    return cells;
  },
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] =>
    cell.dimensions.route === "change"
      ? [
          { description: `[${cell.cell_id}] one actor gets BOTH a valid user key and gateway enrollment` },
          { description: `[${cell.cell_id}] start + prove a user-key session; then switch selected route to gateway in the UI` },
          { description: `[${cell.cell_id}] a new session starts on gateway with correlated LiteLLM spend; the old session stays user-key` },
        ]
      : [
          { description: `[${cell.cell_id}] store + select the harness's run-scoped provider key through the Settings UI` },
          { description: `[${cell.cell_id}] create a user-key session and complete one bounded turn on the direct provider model` },
          { description: `[${cell.cell_id}] assert launch route = user key, no LiteLLM spend row, no managed balance change` },
        ],
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    const routeChange = cells.filter((cell) => cell.dimensions.route === "change");
    const userKey = cells.filter((cell) => cell.dimensions.route !== "change");
    const outcomes: ScenarioCellOutcome[] = [];
    if (userKey.length > 0) {
      outcomes.push(...(await collectLocal3UserKeyCells(ctx, userKey)));
    }
    for (const cell of routeChange) {
      outcomes.push(await collectLocal6RouteChangeCell(ctx, cell));
    }
    return outcomes;
  },
};
