/**
 * Explicit-selector plan building and deterministic shard scoping.
 *
 * A selector resolves the exact required cell set before execution. The
 * foundation CLI uses an explicit selector (--world/--cells); merge and release
 * selectors are additional selectors that produce the same SelectedCellPlan
 * shape. Legacy collectors are marked `legacy: true` so strict evaluation
 * rejects them even when green.
 *
 * Shard scoping reuses the frozen contracts/plan.ts assignShards so a cell lands
 * on the same shard on any host, in any process, for the same plan + count.
 */

import { assignShards } from "../contracts/plan.js";
import type { PlannedCell, SelectedCellPlan } from "../contracts/plan.js";
import type { CellIdentity, ProductHost, ResultBehavior, WorldId } from "../contracts/identity.js";
import { cellKey } from "../contracts/identity.js";
import type { ShardIdentity } from "../contracts/identity.js";

/**
 * Legacy collector scenario ids (from the Legacy Collector ID Migration table in
 * core-release-validation.md). A cell whose scenario id is legacy runs
 * diagnostic-only and can never qualify.
 */
export const LEGACY_SCENARIO_IDS: ReadonlySet<string> = new Set([
  "T3-GW-1",
  "T3-UPDATE-1",
  "T4-CLOUD-1",
  "T4-SH-1",
  "T4-SH-2",
  "T3-FIXTURE",
  "T3-EXAMPLE",
  "T3-A",
  "T3-B",
]);

export function isLegacyScenarioId(scenarioId: string): boolean {
  return LEGACY_SCENARIO_IDS.has(scenarioId);
}

export interface CellSpec {
  readonly scenarioId: string;
  readonly world: WorldId;
  readonly productHost?: ProductHost | null;
  readonly dimensions?: Readonly<Record<string, string>>;
  readonly disposition?: "required" | "not_required" | "deferred";
  /** Force legacy marking; otherwise derived from the scenario id. */
  readonly legacy?: boolean;
}

export interface BuildPlanInput {
  readonly selector: string;
  readonly behavior: ResultBehavior;
  readonly cells: readonly CellSpec[];
  /** Deferred guarantee ids that no journey references yet. */
  readonly deferredScenarioIds?: readonly string[];
}

export function buildPlan(input: BuildPlanInput): SelectedCellPlan {
  const planned: PlannedCell[] = input.cells.map((spec) => {
    const cell: CellIdentity = {
      scenarioId: spec.scenarioId,
      world: spec.world,
      productHost: spec.productHost ?? null,
      dimensions: spec.dimensions ?? {},
    };
    const key = cellKey(cell);
    return {
      cell,
      cellKey: key,
      disposition: spec.disposition ?? "required",
      legacy: spec.legacy ?? isLegacyScenarioId(spec.scenarioId),
    };
  });

  const seen = new Set<string>();
  for (const cell of planned) {
    if (seen.has(cell.cellKey)) {
      throw new Error(`duplicate cell in plan: ${cell.cellKey}`);
    }
    seen.add(cell.cellKey);
  }

  const worlds = [...new Set(planned.map((c) => c.cell.world))];
  return {
    selector: input.selector,
    behavior: input.behavior,
    worlds,
    cells: planned,
    deferredScenarioIds: input.deferredScenarioIds ?? [],
  };
}

/**
 * Returns the subset of the plan assigned to `shard`. Deterministic: identical
 * plan + shard count yields identical membership on any host. Deferred ids and
 * selector/behavior carry through unchanged.
 */
export function shardScopedPlan(plan: SelectedCellPlan, shard: ShardIdentity): SelectedCellPlan {
  const assignment = assignShards(plan.cells, shard.shardCount);
  const cells = plan.cells.filter(
    (cell) => assignment.assignments[cell.cellKey] === shard.shardIndex - 1,
  );
  const worlds = [...new Set(cells.map((c) => c.cell.world))];
  return { ...plan, worlds, cells };
}
