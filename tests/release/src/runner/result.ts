import type { RuntimeLane } from "../config/types.js";

/**
 * Cell state, finalization invariants, behavior policy, verdict, and intended
 * exit code, per specs/developing/testing/qualification-runner-core.md
 * ("Final test results" / "Diagnostic and strict verdicts") as extended by
 * specs/developing/testing/exact-test-matrix.md: the selected unit is an
 * exact test cell (`scenario/lane` for leaves, `scenario/lane/dim=value` for
 * matrix children), and every planned cell must receive exactly one result.
 */

export type ResultBehavior = "diagnostic" | "strict";

/** `pending` is internal only and never serialized. */
export type FinalTestStatus =
  | "green"
  | "failed"
  | "blocked"
  | "expected_fail"
  | "cancelled"
  | "not_run"
  | "missing";

export const ALL_FINAL_STATUSES: readonly FinalTestStatus[] = [
  "green",
  "failed",
  "blocked",
  "expected_fail",
  "cancelled",
  "not_run",
  "missing",
];

/** Terminal states scenario code may declare for its own cells; the runner owns the rest. */
export const SCENARIO_DECLARABLE_STATUSES = ["green", "failed", "blocked", "expected_fail"] as const;
export type ScenarioDeclarableStatus = (typeof SCENARIO_DECLARABLE_STATUSES)[number];

export type ResultReasonCode =
  | "missing_requirement"
  | "scenario_blocked"
  | "known_gap"
  | "scenario_failure"
  | "strict_preflight_failed"
  | "dry_run"
  | "plan_error"
  | "missing_result";

export interface ResultReason {
  code: ResultReasonCode;
  message: string;
}

/**
 * One exactly-planned test cell. The selected-cell array is the complete test
 * plan for an invocation; the runner (runner/plan.ts), not scenario code,
 * creates cell ids.
 */
export interface PlannedCellV1 {
  cell_id: string;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: RuntimeLane;
  /** Sorted-key matrix dimensions; empty for leaf cells. */
  dimensions: Record<string, string>;
  required_env: string[];
}

export interface FinalCellResultV1 {
  cell_id: string;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: RuntimeLane;
  dimensions: Record<string, string>;
  status: FinalTestStatus;
  started_at: string | null;
  finished_at: string;
  duration_ms: number | null;
  reason: ResultReason | null;
  plan_steps: string[];
}

export interface RunnerErrorV1 {
  code: "runner_error";
  message: string;
}

export interface IntegrityErrorV1 {
  code: "duplicate_result" | "selection_result_mismatch" | "summary_mismatch" | "real_execution_not_run";
  message: string;
}

export type VerdictStatus = "selected_cells_passed" | "selected_cells_failed" | "non_qualifying";

export interface Finalization {
  status: FinalTestStatus;
  reason?: ResultReason;
  startedAt?: string | null;
  finishedAt?: string;
  durationMs?: number | null;
  planSteps?: string[];
}

/**
 * Tracks one pending slot per planned cell and enforces the finalization
 * invariants: exactly one final result per planned cell, first accepted
 * result wins, duplicates and missing results are integrity errors.
 */
export class ResultTracker {
  private readonly selected: readonly PlannedCellV1[];
  private readonly results = new Map<string, FinalCellResultV1>();
  readonly integrityErrors: IntegrityErrorV1[] = [];
  readonly runnerErrors: RunnerErrorV1[] = [];

  constructor(selected: readonly PlannedCellV1[]) {
    this.selected = selected;
  }

  get selectedCells(): readonly PlannedCellV1[] {
    return this.selected;
  }

  pendingCells(): PlannedCellV1[] {
    return this.selected.filter((cell) => !this.results.has(cell.cell_id));
  }

  recordRunnerError(code: RunnerErrorV1["code"], message: string): void {
    this.runnerErrors.push({ code, message });
  }

  recordIntegrityError(code: IntegrityErrorV1["code"], message: string): void {
    this.integrityErrors.push({ code, message });
  }

  finalize(cellId: string, finalization: Finalization): void {
    const cell = this.selected.find((candidate) => candidate.cell_id === cellId);
    if (!cell) {
      this.integrityErrors.push({
        code: "selection_result_mismatch",
        message: `Result recorded for "${cellId}", which is not a planned cell.`,
      });
      return;
    }
    if (this.results.has(cellId)) {
      this.integrityErrors.push({
        code: "duplicate_result",
        message: `Duplicate finalization for "${cellId}" (${finalization.status}); the first result is retained.`,
      });
      return;
    }
    this.results.set(cellId, {
      cell_id: cell.cell_id,
      scenario_id: cell.scenario_id,
      registry_flow_ref: cell.registry_flow_ref,
      runtime_lane: cell.runtime_lane,
      dimensions: { ...cell.dimensions },
      status: finalization.status,
      started_at: finalization.startedAt ?? null,
      finished_at: finalization.finishedAt ?? new Date().toISOString(),
      duration_ms: finalization.durationMs ?? null,
      reason: finalization.reason ?? null,
      plan_steps: finalization.planSteps ?? [],
    });
  }

  /**
   * Synthesizes `missing` for any planned cell with no recorded outcome and
   * records the integrity error; returns every result in selection order.
   */
  finalizeRun(execution: "real" | "dry_run"): FinalCellResultV1[] {
    for (const cell of this.pendingCells()) {
      this.integrityErrors.push({
        code: "selection_result_mismatch",
        message: `Planned cell "${cell.cell_id}" ended with no recorded result; synthesized as missing.`,
      });
      this.finalize(cell.cell_id, {
        status: "missing",
        reason: { code: "missing_result", message: "Finalization found no result for this planned cell." },
      });
    }
    const results = this.selected.map((cell) => this.results.get(cell.cell_id)!);
    if (execution === "real") {
      for (const result of results) {
        if (result.status === "not_run") {
          this.integrityErrors.push({
            code: "real_execution_not_run",
            message: `"${result.cell_id}" is not_run during real execution.`,
          });
        }
      }
    }
    return results;
  }
}

export interface VerdictInput {
  behavior: ResultBehavior;
  results: readonly FinalCellResultV1[];
  integrityErrors: readonly IntegrityErrorV1[];
  runnerErrors: readonly RunnerErrorV1[];
}

export interface DerivedVerdict {
  status: VerdictStatus;
  reasons: string[];
  intendedExitCode: 0 | 1 | 2;
}

export function countByStatus(results: readonly FinalCellResultV1[]): Record<FinalTestStatus, number> {
  const counts = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

/**
 * The diagnostic/strict verdict matrix. Diagnostic is always non-qualifying;
 * strict passes only when every selected real cell is green and there are no
 * runner or integrity errors. Any runner/integrity error exits 2 in both
 * behaviors.
 */
export function deriveVerdict(input: VerdictInput): DerivedVerdict {
  const counts = countByStatus(input.results);
  const reasons: string[] = [];
  const hasErrors = input.integrityErrors.length > 0 || input.runnerErrors.length > 0;

  for (const error of input.integrityErrors) {
    reasons.push(`integrity error: ${error.message}`);
  }
  for (const error of input.runnerErrors) {
    reasons.push(`runner error (${error.code}): ${error.message}`);
  }

  const nonGreen = ALL_FINAL_STATUSES.filter((status) => status !== "green" && counts[status] > 0);
  for (const status of nonGreen) {
    reasons.push(`${counts[status]} selected cell(s) finished ${status}`);
  }

  if (input.behavior === "diagnostic") {
    reasons.push("diagnostic behavior never qualifies a candidate");
    const failedLike = counts.failed + counts.cancelled + counts.missing;
    const exit: 0 | 1 | 2 = hasErrors ? 2 : failedLike > 0 ? 1 : 0;
    return { status: "non_qualifying", reasons, intendedExitCode: exit };
  }

  const allGreen = input.results.length > 0 && input.results.every((result) => result.status === "green");
  if (allGreen && !hasErrors) {
    return {
      status: "selected_cells_passed",
      reasons: ["every selected cell is green; scope is selected cells only, completeness partial"],
      intendedExitCode: 0,
    };
  }
  return {
    status: "selected_cells_failed",
    reasons,
    intendedExitCode: hasErrors ? 2 : 1,
  };
}
