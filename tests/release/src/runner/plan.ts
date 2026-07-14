import type { DesktopMode } from "../config/types.js";
import { isMatrixScenario, type ScenarioCellSpec, type ScenarioDefinition } from "../scenarios/types.js";
import type { PlannedCellV1 } from "./result.js";

/**
 * Exact-cell expansion and validation
 * (specs/developing/testing/exact-test-matrix.md "Cell identity"). The
 * selected-cell array produced here is the complete test plan for one
 * invocation: leaf scenarios keep their unchanged `<scenario>/<lane>` cell,
 * matrix scenarios declare child specs that the runner turns into
 * `<scenario>/<lane>/<key>=<value>` cells with runner-created ids. Invalid,
 * empty, or duplicate expansion throws before any setup side effect.
 */

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

// Bounded stable identifiers for dimension keys; values are non-empty,
// bounded, and safely encoded into the cell id.
const DIMENSION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_DIMENSION_VALUE_LENGTH = 128;

export interface PlanInputs {
  desktop: DesktopMode;
  /** Resolved `--agents` selection (catalog harness kinds), or ["all"]. */
  agents: readonly string[];
}

/**
 * Deterministically expands the selected scenarios into the exact planned
 * cell list, sorted by `cell_id` regardless of declaration or selector order.
 */
export async function buildPlannedCells(
  scenarios: readonly ScenarioDefinition[],
  inputs: PlanInputs,
): Promise<PlannedCellV1[]> {
  const cells: PlannedCellV1[] = [];
  const seenCellIds = new Set<string>();
  const seenScenarioIds = new Set<string>();

  for (const scenario of scenarios) {
    // Duplicate scenario ids are rejected outright: later lookup is by
    // scenario id, so two definitions sharing an id — even with disjoint
    // lanes — could execute one body while reporting the other's metadata.
    if (seenScenarioIds.has(scenario.id)) {
      throw new SelectionError(`Duplicate scenario id "${scenario.id}" in the selection.`);
    }
    seenScenarioIds.add(scenario.id);

    for (const runtimeLane of scenario.lanes) {
      if (!isMatrixScenario(scenario)) {
        addCell(cells, seenCellIds, {
          cell_id: `${scenario.id}/${runtimeLane}`,
          scenario_id: scenario.id,
          registry_flow_ref: scenario.registryFlowRef,
          runtime_lane: runtimeLane,
          dimensions: {},
          required_env: [...scenario.requiredEnv],
        });
        continue;
      }

      const specs = await scenario.expandCells({
        runtimeLane,
        desktop: inputs.desktop,
        agents: inputs.agents,
      });
      if (specs.length === 0) {
        throw new SelectionError(
          `Matrix scenario "${scenario.id}" expanded to zero cells for lane "${runtimeLane}".`,
        );
      }
      for (const spec of specs) {
        addCell(cells, seenCellIds, {
          cell_id: cellIdFor(scenario.id, runtimeLane, validateDimensions(scenario.id, spec)),
          scenario_id: scenario.id,
          registry_flow_ref: scenario.registryFlowRef,
          runtime_lane: runtimeLane,
          dimensions: sortedDimensions(spec.dimensions),
          required_env: [...new Set([...scenario.requiredEnv, ...(spec.requiredEnv ?? [])])],
        });
      }
    }
  }

  if (cells.length === 0) {
    throw new SelectionError("Selection expanded to zero cells.");
  }
  cells.sort((a, b) => (a.cell_id < b.cell_id ? -1 : a.cell_id > b.cell_id ? 1 : 0));
  return cells;
}

function addCell(cells: PlannedCellV1[], seen: Set<string>, cell: PlannedCellV1): void {
  if (seen.has(cell.cell_id)) {
    throw new SelectionError(`Duplicate expanded cell id "${cell.cell_id}".`);
  }
  seen.add(cell.cell_id);
  cells.push(cell);
}

function validateDimensions(scenarioId: string, spec: ScenarioCellSpec): Record<string, string> {
  const keys = Object.keys(spec.dimensions);
  if (keys.length === 0) {
    // A dimensionless matrix cell would collide with the scenario's own leaf
    // id form; a matrix child must be distinguishable by at least one key.
    throw new SelectionError(`Matrix scenario "${scenarioId}" declared a cell with no dimensions.`);
  }
  for (const key of keys) {
    if (!DIMENSION_KEY_PATTERN.test(key)) {
      throw new SelectionError(`Matrix scenario "${scenarioId}" declared an invalid dimension key "${key}".`);
    }
    const value = spec.dimensions[key];
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_DIMENSION_VALUE_LENGTH) {
      throw new SelectionError(
        `Matrix scenario "${scenarioId}" declared an empty or unbounded value for dimension "${key}".`,
      );
    }
  }
  return spec.dimensions;
}

function sortedDimensions(dimensions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(dimensions)
      .sort()
      .map((key) => [key, dimensions[key]]),
  );
}

/**
 * The canonical runner-created cell id: `<scenario>/<lane>` for leaf cells
 * (no dimensions) and `<scenario>/<lane>/<k>=<encoded v>` with dimension keys
 * sorted lexicographically for matrix cells. The report validator recomputes
 * ids through this same function, so a coordinated cell-id/dimension edit in
 * persisted evidence cannot validate.
 */
export function canonicalCellId(
  scenarioId: string,
  runtimeLane: string,
  dimensions: Record<string, string>,
): string {
  const keys = Object.keys(dimensions).sort();
  if (keys.length === 0) {
    return `${scenarioId}/${runtimeLane}`;
  }
  const suffix = keys.map((key) => `${key}=${encodeURIComponent(dimensions[key])}`).join(",");
  return `${scenarioId}/${runtimeLane}/${suffix}`;
}

function cellIdFor(scenarioId: string, runtimeLane: string, dimensions: Record<string, string>): string {
  return canonicalCellId(scenarioId, runtimeLane, dimensions);
}
