import type { ReportMaterializationRequest } from "@proliferate/cloud-sdk/types";
import type { CloudWorkspaceMaterializationSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { pathsEqualCanonical } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

/**
 * PR 6 — the pure materialization health/reconciliation planner. On Desktop
 * startup, relevant workspace selection, and explicit Retry, the health pass
 * compares THIS install's local_desktop materialization rows to the local
 * AnyHarness inventory and derives the reports/replays to issue. Pure so the
 * matrix (missing id/path, branch/HEAD mismatch, single-generation replay,
 * unreachable preserves records) is unit-testable away from the network.
 *
 * Bounded scope (§ Materialization reconciliation): the planner only ever
 * reasons over the rows it is handed (current-install materializations for
 * current/recent workspaces) against the local inventory. It NEVER scans
 * arbitrary local repos and NEVER adopts an unrelated path/workspace.
 *
 * Server contract rails (reconciliation §C-10/§C-11):
 *  - Only `state:"hydrated"` reports are sha/branch-guarded by the server, so a
 *    detected branch/HEAD mismatch is reported EXPLICITLY as `inconsistent`
 *    (with the observed fields) — never as a re-`hydrated` that expects the
 *    server to downgrade it (that is a hard 409).
 *  - A missing id/path is reported as `missing`.
 *  - Replay is single-generation only: re-issue against the SAME row+generation;
 *    a bumped generation is a fresh operation, never a cross-generation replay.
 */

/** One local AnyHarness workspace's identity + live head, as read from the
 * runtime inventory / git status. `unreachable` marks a row whose runtime could
 * not be queried at all (the association must be preserved, never mutated). */
export interface LocalInventoryEntry {
  anyharnessWorkspaceId: string;
  worktreePath: string | null;
  /** The live current branch, or null if unknown/detached. */
  observedBranch: string | null;
  /** The live HEAD sha, or null if unknown. */
  observedHeadSha: string | null;
}

export type MaterializationReconciliationActionKind =
  | "report-missing"
  | "report-inconsistent"
  | "replay-operation"
  | "healthy"
  | "unreachable-preserve";

export interface MaterializationReconciliationAction {
  kind: MaterializationReconciliationActionKind;
  materializationId: string;
  generation: number;
  /** A ready-to-send report body for report-missing / report-inconsistent.
   * Absent for replay/healthy/unreachable. */
  report?: ReportMaterializationRequest;
  /** For replay-operation: the single-generation operation id root to re-issue
   * (`"{rowId}:{generation}"`). Deterministic per-step ids are derived by the
   * orchestration; this is the root only. */
  replayOperationId?: string;
  /** Human-facing reason (diagnosis), for logging/telemetry. */
  reason: string;
}

export interface MaterializationReconciliationInput {
  /** THIS install's local_desktop materialization rows for the workspaces in
   * scope (already filtered to current-install by the caller). */
  rows: CloudWorkspaceMaterializationSummary[];
  /** The local AnyHarness inventory, keyed by anyharnessWorkspaceId. */
  inventory: LocalInventoryEntry[];
  /** Ids whose runtime could not be reached at all this pass; their rows are
   * preserved (unreachable), never reported missing. */
  unreachableAnyharnessWorkspaceIds?: string[];
}

/** The idempotency root PR 3/PR 4 established: `"{rowId}:{generation}"`. Replay
 * re-issues the SAME id; a bumped generation yields a new id (fresh op). */
export function materializationOperationIdFor(rowId: string, generation: number): string {
  return `${rowId}:${generation}`;
}

/**
 * Plan the health pass. Returns one action per row. The caller executes them
 * (PUT reports / replay) and invalidates queries; this function performs no I/O
 * and mutates nothing.
 */
export function planMaterializationReconciliation(
  input: MaterializationReconciliationInput,
): MaterializationReconciliationAction[] {
  const unreachable = new Set(input.unreachableAnyharnessWorkspaceIds ?? []);
  const byId = new Map<string, LocalInventoryEntry>();
  for (const entry of input.inventory) {
    byId.set(entry.anyharnessWorkspaceId, entry);
  }

  const actions: MaterializationReconciliationAction[] = [];
  for (const row of input.rows) {
    if (row.targetKind !== "local_desktop") {
      continue;
    }
    actions.push(planRow(row, byId, unreachable));
  }
  return actions;
}

function planRow(
  row: CloudWorkspaceMaterializationSummary,
  byId: Map<string, LocalInventoryEntry>,
  unreachable: Set<string>,
): MaterializationReconciliationAction {
  const opId = materializationOperationIdFor(row.id, row.generation);

  // A row that never finished hydrating (pending/hydrating/failed) with no local
  // presence is a candidate for single-generation replay of the interrupted
  // operation. We only replay when the row is still mid-flight for THIS
  // generation — a hydrated row is complete, a missing/inconsistent row is a
  // durable diagnosis, not an interrupted op.
  const localId = row.anyharnessWorkspaceId;
  const entry = localId ? byId.get(localId) ?? null : null;

  if (localId && unreachable.has(localId)) {
    return {
      kind: "unreachable-preserve",
      materializationId: row.id,
      generation: row.generation,
      reason: "Local runtime unreachable this pass; association preserved.",
    };
  }

  if (row.state === "pending" || row.state === "hydrating") {
    // Interrupted operation: re-issue the exact same-generation op id so PR 3
    // replays its ledger result (no duplicate worktree) and PR 4 re-reports.
    return {
      kind: "replay-operation",
      materializationId: row.id,
      generation: row.generation,
      replayOperationId: opId,
      reason: `Row is ${row.state}; replay the interrupted operation ${opId}.`,
    };
  }

  // Missing id or path: no local workspace matches this row's recorded id, or
  // the recorded worktree path is gone. Report `missing` (unless already so).
  const idMissing = !localId || entry === null;
  if (idMissing) {
    if (row.state === "missing") {
      return healthy(row, "Already reported missing.");
    }
    return {
      kind: "report-missing",
      materializationId: row.id,
      generation: row.generation,
      report: { generation: row.generation, state: "missing" },
      reason: "No local workspace matches this materialization's id.",
    };
  }

  // A row that records a worktree path which no longer matches the inventory
  // entry's path is also missing (the checkout moved/gone).
  if (
    row.worktreePath
    && entry.worktreePath
    && !pathsEqualCanonical(row.worktreePath, entry.worktreePath)
  ) {
    if (row.state === "missing") {
      return healthy(row, "Already reported missing.");
    }
    return {
      kind: "report-missing",
      materializationId: row.id,
      generation: row.generation,
      report: { generation: row.generation, state: "missing" },
      reason: "The recorded worktree path no longer matches the local checkout.",
    };
  }

  // Branch/HEAD mismatch on a present checkout: the materialization is at a
  // DIFFERENT head than expected → `inconsistent` (never re-`hydrated`).
  const expectedHead = row.observedHeadSha ?? row.expectedHeadSha ?? null;
  const headMismatch = expectedHead !== null
    && entry.observedHeadSha !== null
    && entry.observedHeadSha !== expectedHead;
  const branchMismatch = row.observedBranch !== null
    && entry.observedBranch !== null
    && entry.observedBranch !== row.observedBranch;

  if (headMismatch || branchMismatch) {
    if (row.state === "inconsistent") {
      return healthy(row, "Already reported inconsistent.");
    }
    return {
      kind: "report-inconsistent",
      materializationId: row.id,
      generation: row.generation,
      report: {
        generation: row.generation,
        state: "inconsistent",
        anyharnessWorkspaceId: entry.anyharnessWorkspaceId,
        worktreePath: entry.worktreePath,
        observedBranch: entry.observedBranch,
        observedHeadSha: entry.observedHeadSha,
      },
      reason: headMismatch
        ? "The local checkout is at a different commit than the ledger records."
        : "The local checkout is on a different branch than the ledger records.",
    };
  }

  return healthy(row, "Local checkout matches the ledger.");
}

function healthy(
  row: CloudWorkspaceMaterializationSummary,
  reason: string,
): MaterializationReconciliationAction {
  return {
    kind: "healthy",
    materializationId: row.id,
    generation: row.generation,
    reason,
  };
}
