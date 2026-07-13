/**
 * Generic single-attempt cell runner: wraps a cell's execution into exactly
 * one `CellAttempt` and one `FinalCellResult` (contracts/results.ts), so
 * every Tier 2 cell in this workstream produces evidence-bound results in the
 * same shape instead of each cell hand-rolling attempt bookkeeping.
 *
 * "Exactly once, evidence-bound" here means: this function is called once per
 * cell per run, records exactly one attempt, and returns a result that is
 * ready to hand to `evaluateRun` (contracts/evaluate.ts) unmodified. A cell
 * that wants internal sub-retries (e.g. Playwright's own `retries: 1`) still
 * surfaces as one attempt at this layer — the sub-tool's retry is inside the
 * "did this cell's guarantee hold" question, not a second cell attempt.
 */

import { randomUUID } from "node:crypto";

import type { CellAttempt, CellStatus, FinalCellResult } from "../../contracts/results.js";
import { cellKey, type CellIdentity } from "../../contracts/identity.js";
import type { EvidenceSink } from "../../contracts/evidence.js";

export interface CellOutcome {
  readonly status: CellStatus;
  /** Sanitized narrative — never a secret value. */
  readonly detail: string;
  /** Provider/product correlation ids for triage — never secrets. */
  readonly correlationIds?: readonly string[];
}

/**
 * Runs `fn`, catching any thrown error and mapping it to a "failed" outcome
 * (never silently swallowed, never converted to a skip). Records one
 * `CellAttempt`, appends it to `evidence`, and returns the single
 * `FinalCellResult` for this cell.
 */
export async function runCell(
  cell: CellIdentity,
  evidence: EvidenceSink,
  fn: () => Promise<CellOutcome>,
): Promise<FinalCellResult> {
  const key = cellKey(cell);
  const startedAt = new Date().toISOString();
  let outcome: CellOutcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = {
      status: "failed",
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
  const finishedAt = new Date().toISOString();
  const attempt: CellAttempt = {
    attemptId: randomUUID(),
    attemptNumber: 1,
    cellKey: key,
    cell,
    status: outcome.status,
    detail: outcome.detail,
    correlationIds: outcome.correlationIds ?? [],
    startedAt,
    finishedAt,
    superseded: false,
  };
  await evidence.append({ kind: "cell-attempt", ...attempt });
  return { cellKey: key, cell, status: attempt.status, attempts: [attempt] };
}
