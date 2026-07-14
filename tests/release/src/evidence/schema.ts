import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";
import type { CandidateBuildEvidenceV1 } from "../artifacts/build-map.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import {
  ALL_FINAL_STATUSES,
  deriveVerdict,
  type FinalCellResultV1,
  type FinalTestStatus,
  type IntegrityErrorV1,
  type PlannedCellV1,
  type ResultBehavior,
  type RunnerErrorV1,
  type VerdictStatus,
} from "../runner/result.js";

/**
 * The versioned combined-report contract, per
 * specs/developing/testing/qualification-runner-core.md ("Combined report"),
 * specs/developing/testing/candidate-build-handoff.md (candidate-artifact
 * evidence), and specs/developing/testing/exact-test-matrix.md ("Combined
 * report V3"), which changes the semantic result unit to an exact test cell.
 * One artifact per invocation/shard/attempt; validated before writing. V1 and
 * V2 are prior contracts recorded in repository history; current code emits
 * only V3.
 */
export interface TestRunReportV3 {
  schema_version: 3;
  kind: "proliferate.test-run";
  /**
   * Artifact ID/version/SHA-256 from the validated candidate build map, or
   * an explicit null when a diagnostic run omitted the map. Never map paths,
   * local paths, raw map JSON, credentials, or command/provider output.
   */
  candidate_build: CandidateBuildEvidenceV1 | null;
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
  selected_cells: PlannedCellV1[];
  results: FinalCellResultV1[];
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
    scope: "selected_cells";
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
 * Scrubs URL userinfo credentials (`scheme://user:token@host`) regardless of
 * where they came from. Exact-value redaction only knows environment-manifest
 * secrets; credentials discovered at runtime (e.g. `gh auth token` embedded
 * in a clone URL) would otherwise pass through untouched.
 */
export function redactUrlCredentials(message: string): string {
  return message.replace(/(\/\/)[^\s/@]+@/g, "$1[REDACTED]@");
}

/**
 * Withholds external response/provider details after the safe diagnostic
 * prefix. Release scenarios wrap those payloads in several ways (HTTP
 * `-> 502:`, `error:`, `failed:`, `returned:`, provider command output, and
 * similar); retaining the prefix preserves the operation/status while keeping
 * raw bodies, SSE messages, and provider stdout/stderr out of evidence.
 */
export function redactExternalPayloads(message: string): string {
  return message
    .replace(
      /(\bexited\s+(?:-?\d+|null)\s*:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\b(?:ssh command|git [^:\n]{0,160})\s+failed(?:\s*\([^\n)]*\))?\s*:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\bcould not parse\b[^:\n]{0,160}\bjson\b[^:\n]{0,160}:\s*)[\s\S]*$/i,
      "$1(output withheld from evidence)",
    )
    .replace(
      /(\bsandbox\b[^:\n]{0,160}\bdid not reach\b[^:\n]{0,160}\blast observed\s*:\s*)[\s\S]*$/i,
      "$1response body withheld from evidence)",
    )
    .replace(
      /((?:->\s*\d{3}|\b(?:provider|gateway|sandbox|materializer|provisioning|completion|turn|session|claim|e2b[\w.-]*)\b[^:\n]{0,160}\b(?:error|errored|failed|warning|returned|reported|got|exited)\b[^:\n]{0,80}|\b(?:last error|got iserror|did not print valid json)\b[^:\n]{0,80}|\b(?:error|failure)\b[^:\n]{0,160}\(got|\(error)\s*:\s*)[\s\S]*$/i,
      "$1(response body withheld from evidence)",
    )
    .replace(
      /\(got\s+(?:\{|\[)[\s\S]*$/i,
      "(provider response withheld from evidence)",
    );
}

/**
 * Applies redaction + bounding to every message-bearing field in the report.
 * Runs before validation/serialization so no exact secret value or overlong
 * message can enter the persisted artifact.
 */
export function sanitizeReport(report: TestRunReportV3, secretValues: readonly string[]): TestRunReportV3 {
  const clean = (message: string): string =>
    boundMessage(redactExternalPayloads(redactUrlCredentials(redactSecrets(message, secretValues))));
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
export function validateReport(report: TestRunReportV3): void {
  if (report.schema_version !== 3 || report.kind !== "proliferate.test-run") {
    throw new ReportValidationError("Report must be schema_version 3, kind proliferate.test-run.");
  }
  validateCandidateBuildEvidence(report.candidate_build);
  // Strict evidence must name the exact bytes it qualified: only diagnostic
  // omission may record null.
  if (report.run.behavior === "strict" && report.candidate_build === null) {
    throw new ReportValidationError("Strict reports require non-null candidate_build identity.");
  }

  const selectedIds = report.selected_cells.map((cell) => cell.cell_id);
  const resultIds = report.results.map((result) => result.cell_id);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new ReportValidationError("Selected cell ids are not unique.");
  }
  if (new Set(resultIds).size !== resultIds.length) {
    throw new ReportValidationError("Result cell ids are not unique.");
  }
  const selectedSet = new Set(selectedIds);
  if (resultIds.length !== selectedIds.length || !resultIds.every((id) => selectedSet.has(id))) {
    throw new ReportValidationError("Selected and result cell ids are not exactly equal sets.");
  }

  // Every result must repeat its planned cell's identity and dimensions
  // exactly — a result that drifts from its plan is tampered evidence.
  const cellsById = new Map(report.selected_cells.map((cell) => [cell.cell_id, cell]));
  for (const result of report.results) {
    const cell = cellsById.get(result.cell_id)!;
    if (
      result.scenario_id !== cell.scenario_id ||
      result.runtime_lane !== cell.runtime_lane ||
      result.registry_flow_ref !== cell.registry_flow_ref
    ) {
      throw new ReportValidationError(
        `Result "${result.cell_id}" does not match its planned cell's scenario/lane/reference.`,
      );
    }
    const cellDims = JSON.stringify(Object.entries(cell.dimensions).sort());
    const resultDims = JSON.stringify(Object.entries(result.dimensions ?? {}).sort());
    if (cellDims !== resultDims) {
      throw new ReportValidationError(`Result "${result.cell_id}" dimensions do not match its planned cell.`);
    }
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
      throw new ReportValidationError(`Unknown result status "${result.status}" for ${result.cell_id}.`);
    }
  }

  // Execution semantics: strict dry-run is an invalid invocation and can
  // never be honest persisted evidence. Diagnostic planning normally
  // finalizes not_run; a post-selection runner defect may instead synthesize
  // missing, which remains valid only with its integrity error below.
  if (report.run.execution === "dry_run") {
    if (report.run.behavior === "strict") {
      throw new ReportValidationError("A strict dry-run report is not representable evidence.");
    }
    const executed = report.results.find(
      (result) => result.status !== "not_run" && result.status !== "missing",
    );
    if (executed) {
      throw new ReportValidationError(
        `Dry-run cannot produce a real result: ${executed.cell_id} is "${executed.status}".`,
      );
    }
  }

  // A missing result exists only as a runner-integrity failure; without its
  // integrity error the report would present unrecorded work as an ordinary
  // (exit-1) outcome instead of forcing exit 2.
  if (report.results.some((result) => result.status === "missing")) {
    const flagged = report.summary.integrity_errors.some(
      (error) => error.code === "selection_result_mismatch",
    );
    if (!flagged) {
      throw new ReportValidationError(
        "A missing result requires its selection_result_mismatch integrity error.",
      );
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

const EVIDENCE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * `candidate_build` must be present on every report — an explicit null for
 * diagnostic omission, otherwise only bounded artifact ID/version/SHA-256
 * triples. Anything path-like, oversized, or extra is rejected so map paths
 * and raw map JSON can never masquerade as evidence.
 */
function validateCandidateBuildEvidence(evidence: CandidateBuildEvidenceV1 | null): void {
  if (evidence === undefined) {
    throw new ReportValidationError("candidate_build must be present (null for diagnostic omission).");
  }
  if (evidence === null) {
    return;
  }
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new ReportValidationError("candidate_build must be an object or null.");
  }
  // No undeclared fields beside `artifacts` — extra keys are how paths or
  // raw map metadata would smuggle into persisted evidence.
  const evidenceKeys = Object.keys(evidence);
  if (evidenceKeys.length !== 1 || evidenceKeys[0] !== "artifacts") {
    throw new ReportValidationError("candidate_build carries exactly one field: artifacts.");
  }
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
    throw new ReportValidationError("candidate_build.artifacts must be a non-empty array.");
  }
  const seen = new Set<string>();
  for (const artifact of evidence.artifacts) {
    const keys = Object.keys(artifact).sort();
    if (keys.join(",") !== "artifact_id,sha256,version") {
      throw new ReportValidationError(
        "candidate_build artifacts carry exactly artifact_id/version/sha256.",
      );
    }
    if (
      typeof artifact.artifact_id !== "string" ||
      artifact.artifact_id.length === 0 ||
      artifact.artifact_id.length > 128 ||
      !EVIDENCE_ARTIFACT_ID_PATTERN.test(artifact.artifact_id)
    ) {
      throw new ReportValidationError("candidate_build artifact_id is missing or unsafe.");
    }
    if (seen.has(artifact.artifact_id)) {
      throw new ReportValidationError(`candidate_build duplicate artifact_id "${artifact.artifact_id}".`);
    }
    seen.add(artifact.artifact_id);
    if (typeof artifact.version !== "string" || artifact.version.length === 0 || artifact.version.length > 128) {
      throw new ReportValidationError("candidate_build version is missing or unbounded.");
    }
    if (typeof artifact.sha256 !== "string" || !EVIDENCE_SHA256_PATTERN.test(artifact.sha256)) {
      throw new ReportValidationError("candidate_build sha256 must be a lowercase 64-hex digest.");
    }
  }
}
