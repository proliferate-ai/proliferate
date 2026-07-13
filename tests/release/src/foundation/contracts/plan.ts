/**
 * Selected cell plan and deterministic shard assignment.
 *
 * A selector resolves the exact required cell set before execution; merge and
 * release qualification are selectors, not execution engines. Planning cannot
 * emit green product evidence.
 */

import type { CellIdentity, ResultBehavior, WorldId } from "./identity.js";
import type { CellProofRequirement } from "./proof.js";

/** Why a cell is in (or out of) the plan. */
export type CellDisposition =
  | "required"
  | "not_required"
  /** In the manifest but no journey references it during foundation build-out. */
  | "deferred";

export interface PlannedCell {
  readonly cell: CellIdentity;
  readonly cellKey: string;
  readonly disposition: CellDisposition;
  /**
   * Legacy collectors run diagnostically but can never qualify. A planned
   * cell marked legacy is rejected by strict evaluation even when green.
   */
  readonly legacy: boolean;
  /**
   * The trusted proof requirement for this cell, derived from its collector
   * definition at plan time. Null only for bare fail-closed placeholders
   * (planned rows with no collector) — a cell with a null requirement can
   * never produce a green result.
   */
  readonly proofRequirement: CellProofRequirement | null;
}

export interface SelectedCellPlan {
  /** Selector that produced the plan, e.g. "merge", "release", "explicit". */
  readonly selector: string;
  readonly behavior: ResultBehavior;
  readonly worlds: readonly WorldId[];
  readonly cells: readonly PlannedCell[];
  /** Deferred guarantee ids enumerated so no run silently drops them. */
  readonly deferredScenarioIds: readonly string[];
  /**
   * Canonical hash of core-release-scenario-manifest.json the selector
   * resolved against. Required (non-null) for the merge and release
   * selectors — an unbound release/merge plan can never qualify. Explicit
   * ad hoc selections may carry null and are always partial baselines.
   */
  readonly scenarioManifestHash: string | null;
}

export interface ShardAssignment {
  readonly shardCount: number;
  /** cellKey -> shardIndex (0-based). Deterministic for a given plan. */
  readonly assignments: Readonly<Record<string, number>>;
}

/**
 * Deterministic cell→shard assignment: stable across hosts and processes for
 * the same plan and shard count. Uses a simple FNV-1a over the cell key.
 */
export function assignShards(
  cells: readonly PlannedCell[],
  shardCount: number,
): ShardAssignment {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, got ${shardCount}`);
  }
  const assignments: Record<string, number> = {};
  for (const planned of cells) {
    assignments[planned.cellKey] = fnv1a(planned.cellKey) % shardCount;
  }
  return { shardCount, assignments };
}

/**
 * The exact deterministic set of cell keys a shard owns under the canonical
 * one-based shard identity. The aggregate uses this to reject a shard that
 * reports finals outside its assignment.
 */
export function shardOwnedCellKeys(
  plan: SelectedCellPlan,
  shard: { readonly shardIndex: number; readonly shardCount: number },
): ReadonlySet<string> {
  const assignment = assignShards(plan.cells, shard.shardCount);
  const owned = new Set<string>();
  for (const cell of plan.cells) {
    if (assignment.assignments[cell.cellKey] === shard.shardIndex - 1) {
      owned.add(cell.cellKey);
    }
  }
  return owned;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
