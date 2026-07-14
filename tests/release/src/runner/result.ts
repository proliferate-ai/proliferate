import type { RuntimeLane } from "../config/types.js";

/**
 * Cell state, finalization invariants, behavior policy, verdict, and intended
 * exit code, per specs/developing/testing/qualification-runner-core.md
 * ("Final test results" / "Diagnostic and strict verdicts").
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

export interface SelectedTestV1 {
  test_id: string;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: RuntimeLane;
}

export interface FinalTestResultV1 {
  test_id: string;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: RuntimeLane;
  status: FinalTestStatus;
  started_at: string | null;
  finished_at: string;
  duration_ms: number | null;
  reason: ResultReason | null;
  plan_steps: string[];
}

export interface RunnerErrorV1 {
  code: "issue_filing_failed" | "runner_error";
  message: string;
}

export interface IntegrityErrorV1 {
  code: "duplicate_result" | "selection_result_mismatch" | "summary_mismatch" | "real_execution_not_run";
  message: string;
}

export type VerdictStatus = "selected_tests_passed" | "selected_tests_failed" | "non_qualifying";

export interface Finalization {
  status: FinalTestStatus;
  reason?: ResultReason;
  startedAt?: string | null;
  finishedAt?: string;
  durationMs?: number | null;
  planSteps?: string[];
}

/**
 * Tracks one pending slot per selected test and enforces the finalization
 * invariants: exactly one final result per selected test, first accepted
 * result wins, duplicates and missing results are integrity errors.
 */
export class ResultTracker {
  private readonly selected: readonly SelectedTestV1[];
  private readonly results = new Map<string, FinalTestResultV1>();
  readonly integrityErrors: IntegrityErrorV1[] = [];
  readonly runnerErrors: RunnerErrorV1[] = [];

  constructor(selected: readonly SelectedTestV1[]) {
    this.selected = selected;
  }

  get selectedTests(): readonly SelectedTestV1[] {
    return this.selected;
  }

  pendingTests(): SelectedTestV1[] {
    return this.selected.filter((test) => !this.results.has(test.test_id));
  }

  recordRunnerError(code: RunnerErrorV1["code"], message: string): void {
    this.runnerErrors.push({ code, message });
  }

  finalize(testId: string, finalization: Finalization): void {
    const test = this.selected.find((candidate) => candidate.test_id === testId);
    if (!test) {
      this.integrityErrors.push({
        code: "selection_result_mismatch",
        message: `Result recorded for "${testId}", which is not a selected test.`,
      });
      return;
    }
    if (this.results.has(testId)) {
      this.integrityErrors.push({
        code: "duplicate_result",
        message: `Duplicate finalization for "${testId}" (${finalization.status}); the first result is retained.`,
      });
      return;
    }
    this.results.set(testId, {
      test_id: test.test_id,
      scenario_id: test.scenario_id,
      registry_flow_ref: test.registry_flow_ref,
      runtime_lane: test.runtime_lane,
      status: finalization.status,
      started_at: finalization.startedAt ?? null,
      finished_at: finalization.finishedAt ?? new Date().toISOString(),
      duration_ms: finalization.durationMs ?? null,
      reason: finalization.reason ?? null,
      plan_steps: finalization.planSteps ?? [],
    });
  }

  /**
   * Synthesizes `missing` for any selected test with no recorded outcome and
   * records the integrity error; returns every result in selection order.
   */
  finalizeRun(execution: "real" | "dry_run"): FinalTestResultV1[] {
    for (const test of this.pendingTests()) {
      this.integrityErrors.push({
        code: "selection_result_mismatch",
        message: `Selected test "${test.test_id}" ended with no recorded result; synthesized as missing.`,
      });
      this.finalize(test.test_id, {
        status: "missing",
        reason: { code: "missing_result", message: "Finalization found no result for this selected test." },
      });
    }
    const results = this.selected.map((test) => this.results.get(test.test_id)!);
    if (execution === "real") {
      for (const result of results) {
        if (result.status === "not_run") {
          this.integrityErrors.push({
            code: "real_execution_not_run",
            message: `"${result.test_id}" is not_run during real execution.`,
          });
        }
      }
    }
    return results;
  }
}

export interface VerdictInput {
  behavior: ResultBehavior;
  results: readonly FinalTestResultV1[];
  integrityErrors: readonly IntegrityErrorV1[];
  runnerErrors: readonly RunnerErrorV1[];
}

export interface DerivedVerdict {
  status: VerdictStatus;
  reasons: string[];
  intendedExitCode: 0 | 1 | 2;
}

export function countByStatus(results: readonly FinalTestResultV1[]): Record<FinalTestStatus, number> {
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
 * strict passes only when every selected real test is green and there are no
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
    reasons.push(`${counts[status]} selected test(s) finished ${status}`);
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
      status: "selected_tests_passed",
      reasons: ["every selected test is green; scope is selected tests only, completeness partial"],
      intendedExitCode: 0,
    };
  }
  return {
    status: "selected_tests_failed",
    reasons,
    intendedExitCode: hasErrors ? 2 : 1,
  };
}
