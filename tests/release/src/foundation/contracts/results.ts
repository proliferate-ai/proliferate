/**
 * Cell attempts, final results, aggregate evidence, and diagnostic/strict
 * evaluation.
 *
 * `green` is the only passing state. Strict requires every selected required
 * cell present exactly once and green, with valid identity and successful
 * cleanup. Diagnostic evidence is always nonqualifying. Dry-run/planning can
 * never emit green product evidence. Legacy collectors can run diagnostically
 * but cannot qualify.
 */

import type { CellIdentity, ResultBehavior } from "./identity.js";
import type { CleanupReconciliation } from "./cleanup.js";
import type { PreflightReport } from "./preflight.js";
import type { SelectedCellPlan } from "./plan.js";

export type CellStatus =
  | "green"
  | "failed"
  | "blocked"
  | "expected_fail"
  | "readiness_failed"
  | "cancelled";

export interface CellAttempt {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly cellKey: string;
  readonly cell: CellIdentity;
  readonly status: CellStatus;
  /** Sanitized narrative for non-green attempts. */
  readonly detail: string;
  /** Provider/product correlation ids needed for triage — never secrets. */
  readonly correlationIds: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  /** True when a later attempt superseded this one; superseded attempts stay recorded. */
  readonly superseded: boolean;
}

export interface FinalCellResult {
  readonly cellKey: string;
  readonly cell: CellIdentity;
  readonly status: CellStatus;
  readonly attempts: readonly CellAttempt[];
}

export type EvaluationVerdict =
  | { readonly qualifying: false; readonly reasons: readonly string[] }
  | { readonly qualifying: true; readonly label: "partial" | "full" };

export interface RunEvaluation {
  readonly behavior: ResultBehavior;
  readonly verdict: EvaluationVerdict;
  /** Required cells with no final result. */
  readonly missingCellKeys: readonly string[];
  /** Cells with more than one final result. */
  readonly duplicateCellKeys: readonly string[];
  /** Required cells whose final status is not green. */
  readonly nonGreenCellKeys: readonly string[];
  /** Newly-blocked diagnostic cells vs the previous run (regression alert). */
  readonly newlyBlockedCellKeys: readonly string[];
}

export interface EvaluationInput {
  readonly plan: SelectedCellPlan;
  readonly preflight: PreflightReport;
  readonly finals: readonly FinalCellResult[];
  readonly cleanup: CleanupReconciliation;
  /** True when the invocation was planning/dry-run only. */
  readonly dryRun: boolean;
  /** Blocked cell keys from the previous diagnostic run, for regression alerts. */
  readonly previousBlockedCellKeys?: readonly string[];
}
