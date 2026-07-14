import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import {
  ALL_FINAL_STATUSES,
  deriveVerdict,
  type FinalTestResultV1,
  type FinalTestStatus,
  type IntegrityErrorV1,
  type ResultBehavior,
  type RunnerErrorV1,
  type SelectedTestV1,
  type VerdictStatus,
} from "../runner/result.js";

/**
 * The versioned combined-report contract, per
 * specs/developing/testing/qualification-runner-core.md ("Combined report").
 * One artifact per invocation/shard/attempt; validated before writing.
 */
export interface TestRunReportV1 {
  schema_version: 1;
  kind: "proliferate.test-run";
  run: RunIdentityV1 & {
    behavior: ResultBehavior;
    execution: "real" | "dry_run";
    started_at: string;
    finished_at: string;
  };
  inputs: {
    target_lane: TargetLane;
    desktop: DesktopMode;
    agents: string[] | "all";
    scenarios: string[] | "all";
  };
  selected_tests: SelectedTestV1[];
  results: FinalTestResultV1[];
  summary: {
    selected: number;
    finalized: number;
    by_status: Record<FinalTestStatus, number>;
    integrity_errors: IntegrityErrorV1[];
    runner_errors: RunnerErrorV1[];
    intended_exit_code: 0 | 1 | 2;
  };
  verdict: {
    status: VerdictStatus;
    scope: "selected_tests";
    completeness: "partial";
    reasons: string[];
  };
}

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

export const MAX_MESSAGE_CODE_POINTS = 4096;

/** Bounds a message to 4,096 Unicode code points. */
export function boundMessage(message: string): string {
  const codePoints = [...message];
  if (codePoints.length <= MAX_MESSAGE_CODE_POINTS) {
    return message;
  }
  return `${codePoints.slice(0, MAX_MESSAGE_CODE_POINTS - 1).join("")}…`;
}

/** Replaces exact resolved secret values anywhere in the string with [REDACTED]. */
export function redactSecrets(message: string, secretValues: readonly string[]): string {
  let redacted = message;
  for (const secret of secretValues) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

/**
 * Applies redaction + bounding to every message-bearing field in the report.
 * Runs before validation/serialization so no exact secret value or overlong
 * message can enter the persisted artifact.
 */
export function sanitizeReport(report: TestRunReportV1, secretValues: readonly string[]): TestRunReportV1 {
  const clean = (message: string): string => boundMessage(redactSecrets(message, secretValues));
  return {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      reason: result.reason ? { ...result.reason, message: clean(result.reason.message) } : null,
      plan_steps: result.plan_steps.map(clean),
    })),
    summary: {
      ...report.summary,
      integrity_errors: report.summary.integrity_errors.map((error) => ({
        ...error,
        message: clean(error.message),
      })),
      runner_errors: report.summary.runner_errors.map((error) => ({ ...error, message: clean(error.message) })),
    },
    verdict: { ...report.verdict, reasons: report.verdict.reasons.map(clean) },
  };
}

/**
 * Validates the report invariants before writing: unique + exactly-equal
 * selected/result test ids, finalized counts, all seven status keys with
 * exact counts, and verdict/exit consistency.
 */
export function validateReport(report: TestRunReportV1): void {
  if (report.schema_version !== 1 || report.kind !== "proliferate.test-run") {
    throw new ReportValidationError("Report must be schema_version 1, kind proliferate.test-run.");
  }

  const selectedIds = report.selected_tests.map((test) => test.test_id);
  const resultIds = report.results.map((result) => result.test_id);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new ReportValidationError("Selected test ids are not unique.");
  }
  if (new Set(resultIds).size !== resultIds.length) {
    throw new ReportValidationError("Result test ids are not unique.");
  }
  const selectedSet = new Set(selectedIds);
  if (resultIds.length !== selectedIds.length || !resultIds.every((id) => selectedSet.has(id))) {
    throw new ReportValidationError("Selected and result test ids are not exactly equal sets.");
  }

  if (report.summary.selected !== selectedIds.length || report.summary.finalized !== report.results.length) {
    throw new ReportValidationError("summary.selected/finalized do not match the selected/result counts.");
  }

  const byStatus = report.summary.by_status;
  for (const status of ALL_FINAL_STATUSES) {
    if (typeof byStatus[status] !== "number") {
      throw new ReportValidationError(`summary.by_status is missing the "${status}" key.`);
    }
  }
  const counted = { ...Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) } as Record<
    FinalTestStatus,
    number
  >;
  for (const result of report.results) {
    counted[result.status] += 1;
  }
  for (const status of ALL_FINAL_STATUSES) {
    if (byStatus[status] !== counted[status]) {
      throw new ReportValidationError(`summary.by_status.${status} does not match the results.`);
    }
  }

  const knownStatuses = new Set<string>(ALL_FINAL_STATUSES);
  for (const result of report.results) {
    if (!knownStatuses.has(result.status)) {
      throw new ReportValidationError(`Unknown result status "${result.status}" for ${result.test_id}.`);
    }
  }

  // A not_run result during real execution is only representable alongside
  // its integrity error; without it the report would disguise unexecuted
  // work as a tolerated outcome.
  if (report.run.execution === "real" && report.results.some((result) => result.status === "not_run")) {
    const flagged = report.summary.integrity_errors.some((error) => error.code === "real_execution_not_run");
    if (!flagged) {
      throw new ReportValidationError(
        "not_run during real execution requires a real_execution_not_run integrity error.",
      );
    }
  }

  // Recompute the complete verdict/exit policy from the results and errors
  // and require the persisted fields to match — the validator, not the
  // producer, is the last line against false-success evidence.
  const expected = deriveVerdict({
    behavior: report.run.behavior,
    results: report.results,
    integrityErrors: report.summary.integrity_errors,
    runnerErrors: report.summary.runner_errors,
  });
  if (report.verdict.status !== expected.status) {
    throw new ReportValidationError(
      `Verdict "${report.verdict.status}" does not match the recomputed "${expected.status}".`,
    );
  }
  if (report.summary.intended_exit_code !== expected.intendedExitCode) {
    throw new ReportValidationError(
      `intended_exit_code ${report.summary.intended_exit_code} does not match the recomputed ${expected.intendedExitCode}.`,
    );
  }
}
