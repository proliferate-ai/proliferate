import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";
import type { CandidateBuildEvidenceV1 } from "../artifacts/build-map.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import { canonicalCellId, dimensionShapeProblem } from "../runner/plan.js";
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

/**
 * ── Report V4 type DELTA (spec "Aggregate evidence") ──────────────────────
 *
 * Report V3 cannot attach proof to a green result. LOCAL-WORLD-SMOKE-1 is the
 * first consumer that justifies V4. V4 keeps every V3 plan/result/verdict
 * semantic and adds ONE bounded optional evidence field to each result.
 *
 * Only the TYPES live here (added by the contracts stage). The V4 validator
 * (`validateReportV4`) and writer changes are owned by the evidence workstream;
 * this stage does not implement them. Required validator behavior, verbatim, is
 * in BRIEF.md "Evidence workstream" — summarized:
 *   - accept `schema_version: 4`, `kind: "proliferate.test-run"`;
 *   - reuse every V3 invariant (identity/dimension/verdict recomputation);
 *   - each result carries `evidence: CellEvidenceV1 | null`; existing cells
 *     emit `null` and keep V3 semantics;
 *   - a GREEN `LOCAL-WORLD-SMOKE-1/*` result with absent/incomplete evidence is
 *     REJECTED;
 *   - reject unknown evidence `kind`, extra fields, unsafe strings (must pass
 *     the same safe-string checks as identity fields), invalid/negative counts,
 *     internally inconsistent token math (prompt+completion === total, all > 0),
 *     non-positive spend, or a `cleanup` block with `failed > 0` /
 *     any deletion boolean false on a green cell.
 */

/** One result's optional bounded evidence; today only the local-workspace turn. */
export type CellEvidenceV1 = LocalWorkspaceTurnEvidenceV1;

export interface LocalWorkspaceTurnEvidenceV1 {
  kind: "local_workspace_turn";
  artifact_ids: string[];
  server_version: string;
  anyharness_version: string;
  harness: "claude";
  model_id: string;
  workspace_id_hash: string;
  session_id_hash: string;
  transcript_reopened: true;
  litellm: {
    token_id_hash: string;
    request_ids: string[];
    window_started_at: string;
    window_finished_at: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    spend_usd: number;
  };
  cleanup: {
    ledger_id_hash: string;
    registered: number;
    reconciled: number;
    failed: number;
    virtual_key_deleted: boolean;
    litellm_subjects_deleted: boolean;
    browser_closed: boolean;
    processes_stopped: boolean;
    containers_removed: boolean;
    local_paths_removed: boolean;
  };
}

/** V4 result: a V3 result plus one bounded optional evidence attachment. */
export interface FinalCellResultV2 extends FinalCellResultV1 {
  evidence: CellEvidenceV1 | null;
}

/**
 * Report V4: structurally V3 with `schema_version: 4` and evidence-bearing
 * results. The evidence workstream promotes the writer/validator to emit and
 * check this; V3 remains recorded history.
 */
export interface TestRunReportV4 extends Omit<TestRunReportV3, "schema_version" | "results"> {
  schema_version: 4;
  results: FinalCellResultV2[];
}

/**
 * The report fields validated identically across V3 and V4 (everything but
 * the version-specific `schema_version` literal and the evidence attached to
 * each V4 result — `FinalCellResultV2` is a structural supertype-safe
 * substitute for `FinalCellResultV1` here). `validateReportCore` is the one
 * shared invariant walk both `validateReport` (V3) and `validateReportV4`
 * (V4) run after their own version-specific header check.
 */
type ValidatableReportCore = Omit<TestRunReportV3, "schema_version">;

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
  // Structured identity fields (cell ids, dimension keys/values) cannot be
  // redacted without making the evidence ambiguous, so a resolved secret
  // appearing there fails closed: no report is produced at all.
  assertNoSecretsInIdentity(report, secretValues);
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
 * Rejects a report whose structured identity fields carry a resolved secret
 * value. Exported for the writer-side tests; execution calls it through
 * `sanitizeReport`.
 */
export function assertNoSecretsInIdentity(report: ValidatableReportCore, secretValues: readonly string[]): void {
  const secrets = secretValues.filter((secret) => secret.length > 0);
  if (secrets.length === 0) {
    return;
  }
  const identityStrings: string[] = [];
  for (const cell of report.selected_cells) {
    identityStrings.push(cell.cell_id, ...Object.keys(cell.dimensions), ...Object.values(cell.dimensions));
  }
  for (const result of report.results) {
    identityStrings.push(result.cell_id, ...Object.keys(result.dimensions), ...Object.values(result.dimensions));
  }
  for (const value of identityStrings) {
    for (const secret of secrets) {
      if (value.includes(secret)) {
        throw new ReportValidationError(
          "A resolved secret value appears in a cell id or dimension; refusing to produce evidence.",
        );
      }
    }
  }
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
  validateReportCore(report);
}

/**
 * Report V4: `schema_version: 4` plus every V3 invariant, plus per-result
 * evidence. Existing cells emit `evidence: null` and keep V3 semantics; a
 * green `LOCAL-WORLD-SMOKE-1` result must carry complete evidence.
 */
export function validateReportV4(report: TestRunReportV4): void {
  if (report.schema_version !== 4 || report.kind !== "proliferate.test-run") {
    throw new ReportValidationError("Report must be schema_version 4, kind proliferate.test-run.");
  }
  validateReportCore(report);
  for (const result of report.results) {
    validateCellEvidence(result);
  }
}

/** The invariant walk shared by `validateReport` (V3) and `validateReportV4`. */
function validateReportCore(report: ValidatableReportCore): void {
  if (report.run.behavior !== "diagnostic" && report.run.behavior !== "strict") {
    throw new ReportValidationError(`Unknown behavior "${report.run.behavior}".`);
  }
  if (report.run.execution !== "real" && report.run.execution !== "dry_run") {
    throw new ReportValidationError(`Unknown execution mode "${report.run.execution}".`);
  }
  if (report.verdict.scope !== "selected_cells" || report.verdict.completeness !== "partial") {
    throw new ReportValidationError(
      "Verdict scope/completeness must be selected_cells/partial; this report cannot claim more.",
    );
  }
  if (report.selected_cells.length === 0) {
    throw new ReportValidationError("A report with zero selected cells is not representable evidence.");
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

  // Every selected cell's id must be re-derivable from its own
  // scenario/lane/dimensions through the same canonical derivation the
  // planner uses — a coordinated edit of cell_id and dimensions together
  // still cannot validate.
  for (const cell of report.selected_cells) {
    if (cell.runtime_lane !== "local" && cell.runtime_lane !== "sandbox") {
      throw new ReportValidationError(`Unknown runtime lane on "${cell.cell_id}".`);
    }
    if (
      !Array.isArray(cell.required_env) ||
      cell.required_env.some((name) => typeof name !== "string")
    ) {
      throw new ReportValidationError(`required_env on "${cell.cell_id}" is malformed.`);
    }
    // The planner's complete dimension rules apply to persisted evidence too:
    // a report carrying dimensions the planner could never have produced
    // (invalid keys, empty/oversized/non-string values) is not valid even if
    // its cell id was edited consistently.
    const dimensionProblem = dimensionShapeProblem(cell.dimensions);
    if (dimensionProblem) {
      throw new ReportValidationError(`Selected cell "${cell.cell_id}" has ${dimensionProblem}.`);
    }
    const expectedId = canonicalCellId(cell.scenario_id, cell.runtime_lane, cell.dimensions ?? {});
    if (cell.cell_id !== expectedId) {
      throw new ReportValidationError(
        `Selected cell id "${cell.cell_id}" is not the canonical id for its scenario/lane/dimensions.`,
      );
    }
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
  const expected = expectedVerdict(report);
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
  // The reasons array is derived evidence too: arbitrary prose (e.g.
  // "production fully qualified") must not validate.
  if (JSON.stringify(report.verdict.reasons) !== JSON.stringify(expected.reasons)) {
    throw new ReportValidationError("verdict.reasons do not match the recomputed derived reasons.");
  }
}

/**
 * The single derivation both the producer (runner/execute.ts, applied after
 * sanitization) and this validator use for the persisted verdict, including
 * the bounded reasons array.
 */
export function expectedVerdict(report: ValidatableReportCore): {
  status: VerdictStatus;
  intendedExitCode: 0 | 1 | 2;
  reasons: string[];
} {
  const derived = deriveVerdict({
    behavior: report.run.behavior,
    results: report.results,
    integrityErrors: report.summary.integrity_errors,
    runnerErrors: report.summary.runner_errors,
  });
  return { ...derived, reasons: derived.reasons.map(boundMessage) };
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

/**
 * ── Report V4 evidence validation ─────────────────────────────────────────
 *
 * Every string field below passes the same bounded, path/secret-hostile
 * safe-token or hash pattern used for candidate-build/identity fields
 * elsewhere in this file: no leading slash, no `..` traversal segment, no
 * whitespace/control/URL-credential characters, bounded length. This is the
 * fail-closed backstop for BRIEF §6.5/§6.6: if a raw secret or local path
 * ever reached an evidence field, `sanitizeSecretsInEvidence` below turns it
 * into a `[REDACTED]`-bearing (or otherwise unsafe) string, and these
 * patterns then reject it rather than silently accepting mangled evidence.
 */
const EVIDENCE_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/;
const MAX_EVIDENCE_TOKEN_LENGTH = 200;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_LITELLM_REQUEST_IDS = 50;

const LOCAL_WORKSPACE_TURN_EVIDENCE_KEYS = [
  "kind",
  "artifact_ids",
  "server_version",
  "anyharness_version",
  "harness",
  "model_id",
  "workspace_id_hash",
  "session_id_hash",
  "transcript_reopened",
  "litellm",
  "cleanup",
] as const;

const LITELLM_EVIDENCE_KEYS = [
  "token_id_hash",
  "request_ids",
  "window_started_at",
  "window_finished_at",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "spend_usd",
] as const;

const CLEANUP_EVIDENCE_KEYS = [
  "ledger_id_hash",
  "registered",
  "reconciled",
  "failed",
  "virtual_key_deleted",
  "litellm_subjects_deleted",
  "browser_closed",
  "processes_stopped",
  "containers_removed",
  "local_paths_removed",
] as const;

function requireExactKeys(value: object, expected: readonly string[], where: string): void {
  const keys = Object.keys(value).sort();
  const expectedSorted = [...expected].sort();
  if (keys.join(",") !== expectedSorted.join(",")) {
    throw new ReportValidationError(`${where} has undeclared or missing field(s).`);
  }
}

function requireSafeEvidenceToken(where: string, value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EVIDENCE_TOKEN_LENGTH ||
    value.includes("..") ||
    !EVIDENCE_SAFE_TOKEN_PATTERN.test(value)
  ) {
    throw new ReportValidationError(`${where} is missing or unsafe.`);
  }
}

function requireEvidenceHash(where: string, value: unknown): void {
  if (typeof value !== "string" || !EVIDENCE_SHA256_PATTERN.test(value)) {
    throw new ReportValidationError(`${where} must be a lowercase 64-hex digest.`);
  }
}

function requireEvidenceTimestamp(where: string, value: unknown): void {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ReportValidationError(`${where} must be an ISO-8601 UTC timestamp.`);
  }
}

function requireNonNegativeInteger(where: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ReportValidationError(`${where} must be a non-negative integer.`);
  }
}

function requireBoolean(where: string, value: unknown): void {
  if (typeof value !== "boolean") {
    throw new ReportValidationError(`${where} must be a boolean.`);
  }
}

/**
 * Validates one result's `evidence: CellEvidenceV1 | null`. `null` is always
 * representable except on a GREEN `LOCAL-WORLD-SMOKE-1` result, which must
 * carry complete evidence (spec "Aggregate evidence" / BRIEF §6.3).
 */
function validateCellEvidence(result: FinalCellResultV2): void {
  // `evidence` is a required field of FinalCellResultV2, but the report
  // ultimately comes from parsed JSON (`writeReportV4`'s caller may pass an
  // externally-constructed object at runtime), so a missing key is still
  // rejected explicitly rather than reading `undefined` as if it were `null`.
  if (!Object.prototype.hasOwnProperty.call(result, "evidence")) {
    throw new ReportValidationError(`Result "${result.cell_id}" must carry an explicit evidence field (or null).`);
  }
  const evidence = result.evidence;
  if (evidence === null) {
    if (result.status === "green" && result.scenario_id === "LOCAL-WORLD-SMOKE-1") {
      throw new ReportValidationError(
        `Green result "${result.cell_id}" for LOCAL-WORLD-SMOKE-1 requires complete evidence.`,
      );
    }
    return;
  }
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new ReportValidationError(`Result "${result.cell_id}" evidence must be an object or null.`);
  }
  const where = `Result "${result.cell_id}" evidence`;
  requireExactKeys(evidence, LOCAL_WORKSPACE_TURN_EVIDENCE_KEYS, where);
  if (evidence.kind !== "local_workspace_turn") {
    throw new ReportValidationError(`${where}.kind is unknown.`);
  }
  if (!Array.isArray(evidence.artifact_ids) || evidence.artifact_ids.length === 0) {
    throw new ReportValidationError(`${where}.artifact_ids must be a non-empty array.`);
  }
  for (const [index, id] of evidence.artifact_ids.entries()) {
    requireSafeEvidenceToken(`${where}.artifact_ids[${index}]`, id);
  }
  requireSafeEvidenceToken(`${where}.server_version`, evidence.server_version);
  requireSafeEvidenceToken(`${where}.anyharness_version`, evidence.anyharness_version);
  if (evidence.harness !== "claude") {
    throw new ReportValidationError(`${where}.harness must be "claude".`);
  }
  requireSafeEvidenceToken(`${where}.model_id`, evidence.model_id);
  requireEvidenceHash(`${where}.workspace_id_hash`, evidence.workspace_id_hash);
  requireEvidenceHash(`${where}.session_id_hash`, evidence.session_id_hash);
  if (evidence.transcript_reopened !== true) {
    throw new ReportValidationError(`${where}.transcript_reopened must be true.`);
  }
  validateLitellmEvidence(where, evidence.litellm);
  validateCleanupEvidence(where, evidence.cleanup, result.status);
}

function validateLitellmEvidence(where: string, litellm: LocalWorkspaceTurnEvidenceV1["litellm"]): void {
  if (typeof litellm !== "object" || litellm === null || Array.isArray(litellm)) {
    throw new ReportValidationError(`${where}.litellm must be an object.`);
  }
  requireExactKeys(litellm, LITELLM_EVIDENCE_KEYS, `${where}.litellm`);
  requireEvidenceHash(`${where}.litellm.token_id_hash`, litellm.token_id_hash);
  if (!Array.isArray(litellm.request_ids) || litellm.request_ids.length === 0) {
    throw new ReportValidationError(`${where}.litellm.request_ids must be a non-empty array.`);
  }
  if (litellm.request_ids.length > MAX_LITELLM_REQUEST_IDS) {
    throw new ReportValidationError(`${where}.litellm.request_ids exceeds the bounded cap of ${MAX_LITELLM_REQUEST_IDS}.`);
  }
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, id] of litellm.request_ids.entries()) {
    requireSafeEvidenceToken(`${where}.litellm.request_ids[${index}]`, id);
    if (seen.has(id)) {
      throw new ReportValidationError(`${where}.litellm.request_ids has a duplicate entry.`);
    }
    seen.add(id);
    if (previous !== undefined && id < previous) {
      throw new ReportValidationError(`${where}.litellm.request_ids must be sorted ascending.`);
    }
    previous = id;
  }
  requireEvidenceTimestamp(`${where}.litellm.window_started_at`, litellm.window_started_at);
  requireEvidenceTimestamp(`${where}.litellm.window_finished_at`, litellm.window_finished_at);
  if (litellm.window_finished_at < litellm.window_started_at) {
    throw new ReportValidationError(`${where}.litellm window_finished_at precedes window_started_at.`);
  }
  for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) {
    const value = litellm[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new ReportValidationError(`${where}.litellm.${field} must be a positive integer.`);
    }
  }
  if (litellm.prompt_tokens + litellm.completion_tokens !== litellm.total_tokens) {
    throw new ReportValidationError(`${where}.litellm token counts are internally inconsistent.`);
  }
  if (typeof litellm.spend_usd !== "number" || !Number.isFinite(litellm.spend_usd) || litellm.spend_usd <= 0) {
    throw new ReportValidationError(`${where}.litellm.spend_usd must be positive.`);
  }
}

function validateCleanupEvidence(
  where: string,
  cleanup: LocalWorkspaceTurnEvidenceV1["cleanup"],
  status: FinalTestStatus,
): void {
  if (typeof cleanup !== "object" || cleanup === null || Array.isArray(cleanup)) {
    throw new ReportValidationError(`${where}.cleanup must be an object.`);
  }
  requireExactKeys(cleanup, CLEANUP_EVIDENCE_KEYS, `${where}.cleanup`);
  requireEvidenceHash(`${where}.cleanup.ledger_id_hash`, cleanup.ledger_id_hash);
  requireNonNegativeInteger(`${where}.cleanup.registered`, cleanup.registered);
  requireNonNegativeInteger(`${where}.cleanup.reconciled`, cleanup.reconciled);
  requireNonNegativeInteger(`${where}.cleanup.failed`, cleanup.failed);
  const deletionFields = [
    "virtual_key_deleted",
    "litellm_subjects_deleted",
    "browser_closed",
    "processes_stopped",
    "containers_removed",
    "local_paths_removed",
  ] as const;
  for (const field of deletionFields) {
    requireBoolean(`${where}.cleanup.${field}`, cleanup[field]);
  }
  // Unconditional: a failed cleanup entry is never representable, green or not.
  if (cleanup.failed > 0) {
    throw new ReportValidationError(`${where}.cleanup.failed must be 0 for persisted evidence.`);
  }
  // Green-cell rule (spec "Cleanup and failure behavior"): a green cell whose
  // cleanup left any deletion incomplete cannot remain green evidence.
  if (status === "green" && deletionFields.some((field) => cleanup[field] !== true)) {
    throw new ReportValidationError(`${where}.cleanup is incomplete on a green result.`);
  }
}

/**
 * Applies the same redaction pipeline message fields use
 * (`redactSecrets`/`redactUrlCredentials`/`boundMessage`) to every
 * string-bearing evidence field before validation, per BRIEF §6.6. A raw
 * secret or local path that somehow reached evidence is turned into a
 * `[REDACTED]`-bearing string here, which the safe-token/hash patterns above
 * then reject rather than silently persisting.
 */
export function sanitizeCellEvidence(
  evidence: CellEvidenceV1 | null,
  secretValues: readonly string[],
): CellEvidenceV1 | null {
  if (evidence === null) {
    return null;
  }
  const clean = (value: string): string => boundMessage(redactUrlCredentials(redactSecrets(value, secretValues)));
  return {
    ...evidence,
    artifact_ids: evidence.artifact_ids.map(clean),
    server_version: clean(evidence.server_version),
    anyharness_version: clean(evidence.anyharness_version),
    model_id: clean(evidence.model_id),
    workspace_id_hash: clean(evidence.workspace_id_hash),
    session_id_hash: clean(evidence.session_id_hash),
    litellm: {
      ...evidence.litellm,
      token_id_hash: clean(evidence.litellm.token_id_hash),
      request_ids: evidence.litellm.request_ids.map(clean),
    },
    cleanup: {
      ...evidence.cleanup,
      ledger_id_hash: clean(evidence.cleanup.ledger_id_hash),
    },
  };
}

/** Applies `sanitizeCellEvidence` to every result in a V4 report. */
export function sanitizeReportV4Evidence(
  report: TestRunReportV4,
  secretValues: readonly string[],
): TestRunReportV4 {
  return {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      evidence: sanitizeCellEvidence(result.evidence, secretValues),
    })),
  };
}
