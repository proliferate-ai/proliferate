import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertNoSecretsInIdentity,
  boundMessage,
  expectedVerdict,
  redactExternalPayloads,
  redactSecrets,
  redactUrlCredentials,
  ReportValidationError,
  sanitizeCellEvidence,
  validateReport,
  validateReportV4,
  type CellEvidenceV1,
  type CloudProvisionTurnEvidenceV1,
  type FinalCellResultV2,
  type LocalCleanupV1,
  type LocalConfigMatrixEvidenceV1,
  type LocalLitellmSpendV1,
  type LocalMcpIntegrationEvidenceV1,
  type LocalRouteTurnEvidenceV1,
  type LocalSessionTabsEvidenceV1,
  type LocalWorkspaceTurnEvidenceV1,
  type SelfHostBaseTurnEvidenceV1,
  type SelfHostInstallClaimEvidenceV1,
  type TestRunReportV3,
  type TestRunReportV4,
} from "./schema.js";
import { reportPath, ReportWriteError, writeReport, writeReportV4 } from "./write.js";
import { canonicalCellId } from "../runner/plan.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";

function validReport(overrides: Partial<TestRunReportV3> = {}): TestRunReportV3 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = 1;
  return {
    schema_version: 3,
    kind: "proliferate.test-run",
    candidate_build: null,
    run: {
      run_id: "run-1",
      shard_id: "shard-1",
      attempt: 1,
      source_sha: "d".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
      behavior: "diagnostic",
      execution: "real",
      started_at: "2026-07-13T00:00:00Z",
      finished_at: "2026-07-13T00:01:00Z",
    },
    inputs: { target_lane: "local", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: "A/local",
        scenario_id: "A",
        registry_flow_ref: "specs#A",
        runtime_lane: "local",
        dimensions: {},
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: "A/local",
        scenario_id: "A",
        registry_flow_ref: "specs#A",
        runtime_lane: "local",
        dimensions: {},
        status: "green",
        started_at: "2026-07-13T00:00:01Z",
        finished_at: "2026-07-13T00:00:59Z",
        duration_ms: 58_000,
        reason: null,
        plan_steps: [],
      },
    ],
    summary: {
      selected: 1,
      finalized: 1,
      by_status: byStatus,
      integrity_errors: [],
      runner_errors: [],
      intended_exit_code: 0,
    },
    verdict: { status: "non_qualifying", scope: "selected_cells", completeness: "partial", reasons: [] },
    ...overrides,
  };
}

/**
 * Reports carry derived reasons; after a test mutates behavior/results it
 * re-derives them the same way the producer does, so validation exercises the
 * field under test instead of tripping the reasons-equality check.
 */
function withDerivedReasons(report: TestRunReportV3): TestRunReportV3 {
  report.verdict.reasons = expectedVerdict(report).reasons;
  return report;
}


// Minimal valid candidate evidence for strict-report tests (strict requires
// non-null candidate_build per CBH-001). Declares every artifact id the
// world-backed evidence fixtures below reference, because the V4 cross-field
// bind (LQF-005) now requires each evidence `artifact_ids` entry to name an
// artifact of THIS candidate identity.
const STRICT_CB: TestRunReportV3["candidate_build"] = {
  artifacts: [
    { artifact_id: "anyharness/host", version: "1.0.0", sha256: "e".repeat(64) },
    { artifact_id: "server/linux-x64", version: "0.3.27", sha256: "1".repeat(64) },
    { artifact_id: "anyharness/aarch64-apple-darwin", version: "0.3.27", sha256: "2".repeat(64) },
    { artifact_id: "desktop-renderer/browser", version: "0.3.27", sha256: "3".repeat(64) },
    { artifact_id: "server/linux-amd64", version: "0.3.27", sha256: "4".repeat(64) },
    { artifact_id: "selfhost-bundle/linux-amd64", version: "0.3.27", sha256: "5".repeat(64) },
    { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "0.3.27", sha256: "6".repeat(64) },
  ],
};

test("validateReport accepts a consistent report", () => {
  validateReport(withDerivedReasons(validReport()));
});

test("validateReport rejects selected/result set mismatch and duplicates", () => {
  const extraSelected = validReport();
  extraSelected.selected_cells.push({
    cell_id: "B/local",
    scenario_id: "B",
    registry_flow_ref: "specs#B",
    runtime_lane: "local",
    dimensions: {},
    required_env: [],
  });
  extraSelected.summary.selected = 2;
  assert.throws(() => validateReport(extraSelected), ReportValidationError);

  const duplicated = validReport();
  duplicated.selected_cells.push({ ...duplicated.selected_cells[0] });
  assert.throws(() => validateReport(duplicated), ReportValidationError);
});

test("validateReport rejects wrong counts, missing status keys, and count drift", () => {
  const wrongSelected = validReport();
  wrongSelected.summary.selected = 5;
  assert.throws(() => validateReport(wrongSelected), ReportValidationError);

  const missingKey = validReport();
  delete (missingKey.summary.by_status as Record<string, number>).missing;
  assert.throws(() => validateReport(missingKey), ReportValidationError);

  const drifted = validReport();
  drifted.summary.by_status.green = 0;
  drifted.summary.by_status.failed = 1;
  assert.throws(() => validateReport(drifted), ReportValidationError);
});

test("validateReport rejects a diagnostic report that claims qualification", () => {
  const report = validReport();
  report.verdict.status = "selected_cells_passed";
  assert.throws(() => validateReport(report), ReportValidationError);
});

test("validateReport enforces the strict verdict against results and errors", () => {
  const passing = validReport();
  passing.run.behavior = "strict";
  passing.candidate_build = STRICT_CB;
  passing.verdict.status = "selected_cells_passed";
  validateReport(withDerivedReasons(passing));

  const mislabeled = validReport();
  mislabeled.run.behavior = "strict";
  mislabeled.candidate_build = STRICT_CB;
  mislabeled.verdict.status = "selected_cells_failed";
  assert.throws(() => validateReport(mislabeled), ReportValidationError);

  const errorButPassed = validReport();
  errorButPassed.run.behavior = "strict";
  errorButPassed.candidate_build = STRICT_CB;
  errorButPassed.verdict.status = "selected_cells_passed";
  errorButPassed.summary.runner_errors = [{ code: "runner_error", message: "x" }];
  assert.throws(() => validateReport(errorButPassed), ReportValidationError);
});

test("validateReport rejects false-success evidence: failed result with exit 0", () => {
  const diagnostic = validReport();
  diagnostic.results[0].status = "failed";
  diagnostic.summary.by_status.green = 0;
  diagnostic.summary.by_status.failed = 1;
  // verdict name is "correct" for diagnostic, but the exit is a lie
  assert.throws(() => validateReport(diagnostic), ReportValidationError);

  const strict = validReport();
  strict.run.behavior = "strict";
  strict.candidate_build = STRICT_CB;
  strict.results[0].status = "failed";
  strict.summary.by_status.green = 0;
  strict.summary.by_status.failed = 1;
  strict.verdict.status = "selected_cells_passed";
  assert.throws(() => validateReport(strict), ReportValidationError);
});

test("validateReport rejects not_run during real execution without its integrity error", () => {
  const report = validReport();
  report.results[0].status = "not_run";
  report.summary.by_status.green = 0;
  report.summary.by_status.not_run = 1;
  assert.throws(() => validateReport(report), ReportValidationError);
});

test("validateReport rejects an unknown result status", () => {
  const report = validReport();
  (report.results[0] as { status: string }).status = "sorta_passed";
  assert.throws(() => validateReport(report), ReportValidationError);
});

// Every verdict-matrix row must survive validation when produced honestly.
// A `missing` result is only honest alongside its integrity error, which
// forces exit 2.
const MATRIX_ROWS: Array<{ statuses: FinalTestStatus[]; behavior: "diagnostic" | "strict"; exit: 0 | 1 | 2; verdict: TestRunReportV3["verdict"]["status"]; execution?: "real" | "dry_run"; integrity?: boolean }> = [
  { statuses: ["green"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["green"], behavior: "strict", exit: 0, verdict: "selected_cells_passed" },
  { statuses: ["blocked"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["blocked"], behavior: "strict", exit: 1, verdict: "selected_cells_failed" },
  { statuses: ["expected_fail"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["expected_fail"], behavior: "strict", exit: 1, verdict: "selected_cells_failed" },
  { statuses: ["green", "failed"], behavior: "diagnostic", exit: 1, verdict: "non_qualifying" },
  { statuses: ["green", "failed"], behavior: "strict", exit: 1, verdict: "selected_cells_failed" },
  { statuses: ["cancelled"], behavior: "strict", exit: 1, verdict: "selected_cells_failed" },
  { statuses: ["missing"], behavior: "diagnostic", exit: 2, verdict: "non_qualifying", integrity: true },
  { statuses: ["not_run"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying", execution: "dry_run" },
];

for (const [index, row] of MATRIX_ROWS.entries()) {
  test(`validateReport accepts honest matrix row ${index}: ${row.behavior} ${row.statuses.join(",")}`, () => {
    const report = validReport();
    report.run.behavior = row.behavior;
    if (row.behavior === "strict") {
      report.candidate_build = STRICT_CB;
    }
    report.run.execution = row.execution ?? "real";
    report.selected_cells = row.statuses.map((_, i) => ({
      cell_id: `S${i}/local`,
      scenario_id: `S${i}`,
      registry_flow_ref: `specs#S${i}`,
      runtime_lane: "local" as const,
      dimensions: {},
      required_env: [],
    }));
    report.results = row.statuses.map((status, i) => ({
      ...report.results[0],
      cell_id: `S${i}/local`,
      scenario_id: `S${i}`,
      registry_flow_ref: `specs#S${i}`,
      status,
    }));
    report.summary.selected = row.statuses.length;
    report.summary.finalized = row.statuses.length;
    const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
      FinalTestStatus,
      number
    >;
    for (const status of row.statuses) {
      byStatus[status] += 1;
    }
    report.summary.by_status = byStatus;
    if (row.integrity) {
      report.summary.integrity_errors = [
        { code: "selection_result_mismatch", message: "synthesized missing result" },
      ];
    }
    report.summary.intended_exit_code = row.exit;
    report.verdict.status = row.verdict;
    validateReport(withDerivedReasons(report));
  });
}

test("validateReport rejects a strict dry-run report outright", () => {
  const report = validReport();
  report.run.behavior = "strict";
  report.candidate_build = STRICT_CB;
  report.run.execution = "dry_run";
  report.results[0].status = "not_run";
  report.summary.by_status.green = 0;
  report.summary.by_status.not_run = 1;
  report.verdict.status = "selected_cells_failed";
  report.summary.intended_exit_code = 1;
  assert.throws(() => validateReport(report), /strict dry-run/i);

  // Even a "green + qualified + exit 0" strict dry-run must not validate.
  const disguised = validReport();
  disguised.run.behavior = "strict";
  disguised.candidate_build = STRICT_CB;
  disguised.run.execution = "dry_run";
  disguised.verdict.status = "selected_cells_passed";
  assert.throws(() => validateReport(disguised), ReportValidationError);
});

test("validateReport rejects real-result statuses inside a diagnostic dry-run", () => {
  const report = validReport();
  report.run.execution = "dry_run";
  // results[0] is green — planning can never produce a real result
  assert.throws(() => validateReport(report), /Dry-run cannot produce a real result/);
});

test("validateReport rejects a missing result without its integrity error", () => {
  const report = validReport();
  report.results[0].status = "missing";
  report.summary.by_status.green = 0;
  report.summary.by_status.missing = 1;
  report.summary.intended_exit_code = 1;
  assert.throws(() => validateReport(report), /selection_result_mismatch/);
});

test("redactUrlCredentials scrubs userinfo tokens from URLs", () => {
  assert.equal(
    redactUrlCredentials("clone https://x-access-token:ghp_abc123@github.com/o/r.git failed"),
    "clone https://[REDACTED]@github.com/o/r.git failed",
  );
  assert.equal(redactUrlCredentials("https://github.com/o/r.git"), "https://github.com/o/r.git");
});

test("redactExternalPayloads retains safe context and withholds external detail", () => {
  const marker = "RAW_PROVIDER_PAYLOAD";
  assert.equal(
    redactExternalPayloads(`gateway /mcp -> 502: {"token":"${marker}"}`),
    "gateway /mcp -> 502: (response body withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`T3: provisioning failed: ${marker}`),
    "T3: provisioning failed: (response body withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`gateway providers mismatch (got [{"token":"${marker}"}])`),
    "gateway providers mismatch (provider response withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`prov1_fallback.py (provision) exited 1: ${marker}`),
    "prov1_fallback.py (provision) exited 1: (output withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`T3-SH-3: ssh command failed (1): ${marker}`),
    "T3-SH-3: ssh command failed (1): (output withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`T4-SH-2: git status failed: ${marker}`),
    "T4-SH-2: git status failed: (output withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(`provisionSelfHostBox: could not parse box JSON from selfhost-box.sh: ${marker}`),
    "provisionSelfHostBox: could not parse box JSON from selfhost-box.sh: (output withheld from evidence)",
  );
  assert.equal(
    redactExternalPayloads(
      `warmPersonalCloudSandbox: sandbox did not reach status=ready within 120000ms ` +
        `(last observed: {"lastError":"${marker}"}).`,
    ),
    "warmPersonalCloudSandbox: sandbox did not reach status=ready within 120000ms " +
      "(last observed: response body withheld from evidence)",
  );
  assert.equal(redactExternalPayloads("ordinary assertion failed"), "ordinary assertion failed");
});

test("validateReport requires exit 2 whenever runner/integrity errors exist", () => {
  const report = validReport();
  report.summary.integrity_errors = [{ code: "duplicate_result", message: "dup" }];
  report.summary.intended_exit_code = 0;
  assert.throws(() => validateReport(report), ReportValidationError);
});

test("boundMessage caps at 4096 code points; redactSecrets replaces exact values", () => {
  assert.equal(boundMessage("short"), "short");
  assert.equal([...boundMessage("x".repeat(5000))].length, 4096);
  assert.equal(redactSecrets("key=abc123 done", ["abc123"]), "key=[REDACTED] done");
  assert.equal(redactSecrets("nothing here", ["abc123"]), "nothing here");
});

test("writeReport writes one parseable artifact at the attempt path with trailing newline", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-"));
  try {
    const report = withDerivedReasons(validReport());
    const written = await writeReport(dir, report);
    assert.equal(written, path.join(dir, "run-1", "shard-1", "attempt-1", "qualification-evidence.json"));
    const raw = await readFile(written, "utf8");
    assert.ok(raw.endsWith("\n"));
    const parsed = JSON.parse(raw);
    assert.equal(parsed.kind, "proliferate.test-run");
    assert.equal(parsed.summary.by_status.green, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeReport refuses to overwrite an existing attempt artifact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-"));
  try {
    await writeReport(dir, withDerivedReasons(validReport()));
    await assert.rejects(writeReport(dir, withDerivedReasons(validReport())), ReportWriteError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("distinct attempts write distinct non-overwriting paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-"));
  try {
    const first = withDerivedReasons(validReport());
    const second = withDerivedReasons(validReport());
    second.run.attempt = 2;
    const path1 = await writeReport(dir, first);
    const path2 = await writeReport(dir, second);
    assert.notEqual(path1, path2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeReport validates before writing: an invalid report writes nothing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-"));
  try {
    const invalid = validReport();
    invalid.summary.selected = 99;
    await assert.rejects(writeReport(dir, invalid), ReportValidationError);
    await assert.rejects(readFile(reportPath(dir, invalid), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateReport requires candidate_build to be present (null or evidence)", () => {
  const absent = validReport();
  delete (absent as Partial<TestRunReportV3>).candidate_build;
  assert.throws(() => validateReport(absent), /candidate_build must be present/);

  const withNull = validReport();
  withNull.candidate_build = null;
  validateReport(withDerivedReasons(withNull));

  const withEvidence = validReport();
  withEvidence.candidate_build = {
    artifacts: [{ artifact_id: "anyharness/aarch64-apple-darwin", version: "0.3.27", sha256: "e".repeat(64) }],
  };
  validateReport(withDerivedReasons(withEvidence));
});

test("validateReport rejects unsafe or path-carrying candidate evidence", () => {
  const reject = (candidate: unknown, pattern: RegExp): void => {
    const report = validReport();
    report.candidate_build = candidate as TestRunReportV3["candidate_build"];
    assert.throws(() => validateReport(report), pattern);
  };
  reject({ artifacts: [] }, /non-empty/);
  reject(
    {
      artifacts: [
        {
          artifact_id: "anyharness/x",
          version: "1",
          sha256: "e".repeat(64),
          path: "/tmp/leaked-local-path",
        },
      ],
    },
    /exactly artifact_id\/version\/sha256/,
  );
  reject(
    { artifacts: [{ artifact_id: "../escape", version: "1", sha256: "e".repeat(64) }] },
    /unsafe/,
  );
  reject(
    { artifacts: [{ artifact_id: "anyharness/x", version: "", sha256: "e".repeat(64) }] },
    /version/,
  );
  reject(
    { artifacts: [{ artifact_id: "anyharness/x", version: "1", sha256: "not-a-digest" }] },
    /64-hex/,
  );
  reject(
    {
      artifacts: [
        { artifact_id: "anyharness/x", version: "1", sha256: "e".repeat(64) },
        { artifact_id: "anyharness/x", version: "2", sha256: "f".repeat(64) },
      ],
    },
    /duplicate/,
  );
});

test("validateReport rejects prior schema versions", () => {
  for (const version of [1, 2]) {
    const report = validReport();
    (report as { schema_version: number }).schema_version = version;
    assert.throws(() => validateReport(report), /schema_version 3/);
  }
});

test("validateReport rejects a result whose identity or dimensions drift from its planned cell", () => {
  const wrongLane = validReport();
  (wrongLane.results[0] as { runtime_lane: string }).runtime_lane = "sandbox";
  assert.throws(() => validateReport(wrongLane), /scenario\/lane\/reference/);

  const wrongScenario = validReport();
  wrongScenario.results[0].scenario_id = "B";
  assert.throws(() => validateReport(wrongScenario), /scenario\/lane\/reference/);

  const wrongDims = validReport();
  wrongDims.results[0].dimensions = { harness: "codex" };
  assert.throws(() => validateReport(wrongDims), /dimensions do not match/);
});

test("strict reports require non-null candidate_build (CBH-001)", () => {
  const strictNull = validReport();
  strictNull.run.behavior = "strict";
  strictNull.verdict.status = "selected_cells_passed";
  strictNull.candidate_build = null;
  assert.throws(() => validateReport(strictNull), /Strict reports require non-null candidate_build/);

  const strictWithEvidence = validReport();
  strictWithEvidence.run.behavior = "strict";
  strictWithEvidence.verdict.status = "selected_cells_passed";
  strictWithEvidence.candidate_build = {
    artifacts: [{ artifact_id: "anyharness/x", version: "1", sha256: "e".repeat(64) }],
  };
  validateReport(withDerivedReasons(strictWithEvidence));
});

test("candidate_build rejects undeclared fields beside artifacts (CBH-002)", () => {
  const report = validReport();
  report.candidate_build = {
    artifacts: [{ artifact_id: "anyharness/x", version: "1", sha256: "e".repeat(64) }],
    map_path: "/tmp/leaked-map.json",
  } as unknown as TestRunReportV3["candidate_build"];
  assert.throws(() => validateReport(report), /exactly one field: artifacts/);
});

test("validateReport rejects invalid modes, false scope/completeness, and empty selections (ETM-001)", () => {
  const badBehavior = validReport();
  (badBehavior.run as { behavior: string }).behavior = "lenient";
  assert.throws(() => validateReport(badBehavior), /Unknown behavior/);

  const badExecution = validReport();
  (badExecution.run as { execution: string }).execution = "simulated";
  assert.throws(() => validateReport(badExecution), /Unknown execution mode/);

  const badScope = validReport();
  (badScope.verdict as { scope: string }).scope = "full_release";
  assert.throws(() => validateReport(badScope), /scope\/completeness/);

  const badCompleteness = validReport();
  (badCompleteness.verdict as { completeness: string }).completeness = "complete";
  assert.throws(() => validateReport(badCompleteness), /scope\/completeness/);

  const empty = validReport();
  empty.selected_cells = [];
  empty.results = [];
  empty.summary.selected = 0;
  empty.summary.finalized = 0;
  empty.summary.by_status.green = 0;
  assert.throws(() => validateReport(empty), /zero selected cells/);
});

test("validateReport rejects coordinated cell-id/dimension tampering (ETM-001)", () => {
  // Both the selected cell and its result are edited consistently — the id
  // no longer derives from the scenario/lane/dimensions, so it must reject.
  const report = validReport();
  report.selected_cells[0].cell_id = "A/local/harness=claude";
  report.results[0].cell_id = "A/local/harness=claude";
  assert.throws(() => validateReport(report), /not the canonical id/);

  const renamed = validReport();
  renamed.selected_cells[0].dimensions = { harness: "codex" };
  renamed.results[0].dimensions = { harness: "codex" };
  // cell_id still says A/local while dimensions claim a matrix child.
  assert.throws(() => validateReport(renamed), /not the canonical id/);
});

test("a resolved secret in a cell id or dimension fails closed (ETM-004)", () => {
  const secret = "sk-live-in-identity";
  const inDimension = validReport();
  inDimension.selected_cells[0].dimensions = { harness: secret };
  assert.throws(() => assertNoSecretsInIdentity(inDimension, [secret]), /refusing to produce evidence/);

  const inResult = validReport();
  inResult.results[0].dimensions = { harness: secret };
  assert.throws(() => assertNoSecretsInIdentity(inResult, [secret]), /refusing to produce evidence/);

  // Clean identities pass, and message redaction still applies elsewhere.
  assertNoSecretsInIdentity(validReport(), [secret]);
});

test("planner-impossible dimensions reject even with a consistently edited id (ETM-001)", () => {
  const cases: Array<Record<string, unknown>> = [
    { "Bad Key": "x" },
    { harness: "" },
    { harness: "x".repeat(200) },
    { harness: ["array", "value"] },
  ];
  for (const dimensions of cases) {
    const report = validReport();
    const dims = dimensions as Record<string, string>;
    // Edit the id consistently with the tampered dimensions so only the
    // dimension-shape rule can catch it.
    report.selected_cells[0].dimensions = dims;
    report.results[0].dimensions = dims;
    try {
      const id = canonicalCellId("A", "local", dims);
      report.selected_cells[0].cell_id = id;
      report.results[0].cell_id = id;
    } catch {
      // encodeURIComponent can throw for exotic values; the raw id stays.
    }
    assert.throws(() => validateReport(report), ReportValidationError, JSON.stringify(dimensions));
  }
});

test("arbitrary verdict reasons cannot validate (ETM-001)", () => {
  const report = withDerivedReasons(validReport());
  report.verdict.reasons = ["production fully qualified"];
  assert.throws(() => validateReport(report), /reasons do not match/);

  const appended = withDerivedReasons(validReport());
  appended.verdict.reasons = [...appended.verdict.reasons, "and also fully audited"];
  assert.throws(() => validateReport(appended), /reasons do not match/);
});

// ── Report V4 (spec "Aggregate evidence" / BRIEF §6) ────────────────────────

function validCellEvidence(overrides: Partial<LocalWorkspaceTurnEvidenceV1> = {}): LocalWorkspaceTurnEvidenceV1 {
  return {
    kind: "local_workspace_turn",
    artifact_ids: ["server/linux-x64", "anyharness/aarch64-apple-darwin", "desktop-renderer/browser"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "claude",
    model_id: "claude-haiku-4-5",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    transcript_reopened: true,
    litellm: {
      token_id_hash: "c".repeat(64),
      request_ids: ["req-1", "req-2"],
      window_started_at: "2026-07-14T00:00:00Z",
      window_finished_at: "2026-07-14T00:00:10Z",
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
      spend_usd: 0.0004,
    },
    cleanup: {
      ledger_id_hash: "d".repeat(64),
      registered: 8,
      reconciled: 8,
      failed: 0,
      virtual_key_deleted: true,
      litellm_subjects_deleted: true,
      browser_closed: true,
      processes_stopped: true,
      containers_removed: true,
      local_paths_removed: true,
    },
    ...overrides,
  };
}

/** V4 report with a single green non-LOCAL-WORLD-SMOKE-1 cell (evidence: null). */
function validReportV4(overrides: Partial<TestRunReportV4> = {}): TestRunReportV4 {
  const v3 = withDerivedReasons(validReport());
  const report: TestRunReportV4 = {
    ...v3,
    schema_version: 4,
    results: v3.results.map((result) => ({ ...result, evidence: null })),
  };
  return { ...report, ...overrides };
}

/**
 * A V4 report whose single result's evidence is known to be the
 * `local_workspace_turn` kind — narrower than `CellEvidenceV1` so these smoke
 * tests can read `.litellm`/`.cleanup`/`.model_id` without a per-access cast
 * after the audit-ruling-#3 union widening. Structurally a `TestRunReportV4`.
 */
type SmokeReportV4 = Omit<TestRunReportV4, "results"> & {
  results: Array<Omit<FinalCellResultV2, "evidence"> & { evidence: LocalWorkspaceTurnEvidenceV1 | null }>;
};

/** V4 report with one green LOCAL-WORLD-SMOKE-1 cell carrying complete evidence. */
function validSmokeReportV4(evidenceOverrides: Partial<LocalWorkspaceTurnEvidenceV1> = {}): SmokeReportV4 {
  const report = validReportV4();
  report.selected_cells[0] = {
    ...report.selected_cells[0],
    cell_id: "LOCAL-WORLD-SMOKE-1/local/harness=claude",
    scenario_id: "LOCAL-WORLD-SMOKE-1",
    registry_flow_ref: "specs#LOCAL-WORLD-SMOKE-1",
    dimensions: { harness: "claude" },
  };
  report.results[0] = {
    ...report.results[0],
    cell_id: "LOCAL-WORLD-SMOKE-1/local/harness=claude",
    scenario_id: "LOCAL-WORLD-SMOKE-1",
    registry_flow_ref: "specs#LOCAL-WORLD-SMOKE-1",
    dimensions: { harness: "claude" },
    evidence: validCellEvidence(evidenceOverrides),
  };
  return report as unknown as SmokeReportV4;
}

/**
 * V4 report with one FAILED LOCAL-WORLD-SMOKE-1 cell whose cleanup did not fully
 * reconcile: the cell records `cleanup.failed > 0` and an incomplete deletion.
 * Per the spec failure table a cleanup failure makes the aggregate non-qualifying
 * and nonzero; the report must still persist (exit 1) rather than throw (exit 2).
 */
function failedCleanupSmokeReportV4(): TestRunReportV4 {
  const report = validSmokeReportV4();
  report.run.behavior = "strict";
  report.candidate_build = STRICT_CB;
  report.results[0] = {
    ...report.results[0],
    status: "failed",
    reason: { code: "scenario_failure", message: "cleanup did not fully reconcile (failed=1)" },
    evidence: validCellEvidence({
      cleanup: {
        ledger_id_hash: "d".repeat(64),
        registered: 8,
        reconciled: 7,
        failed: 1,
        virtual_key_deleted: false,
        litellm_subjects_deleted: true,
        browser_closed: true,
        processes_stopped: true,
        containers_removed: true,
        local_paths_removed: true,
      },
    }),
  };
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.failed = 1;
  report.summary.by_status = byStatus;
  report.summary.intended_exit_code = 1;
  report.verdict.status = "selected_cells_failed";
  // withDerivedReasons mutates verdict.reasons in place; the V3 parameter type is
  // structurally satisfied (V4 only adds schema_version 4 + per-result evidence).
  withDerivedReasons(report as unknown as TestRunReportV3);
  return report;
}

// Narrows the first result's evidence to the local-workspace-turn kind so tests
// can reach kind-specific fields (litellm, cleanup.virtual_key_deleted) now that
// CellEvidenceV1 is a discriminated union across multiple worlds. Returns the
// live object reference, so in-place mutation still edits the report.
function smokeTurn(report: TestRunReportV4): LocalWorkspaceTurnEvidenceV1 {
  const evidence = report.results[0].evidence;
  assert.ok(evidence && evidence.kind === "local_workspace_turn");
  return evidence;
}

test("validateReportV4 accepts schema_version 4 with null evidence on an ordinary cell", () => {
  validateReportV4(validReportV4());
});

test("validateReportV4 rejects schema_version 3 and non-4 versions", () => {
  const report = validReportV4();
  (report as { schema_version: number }).schema_version = 3;
  assert.throws(() => validateReportV4(report), /schema_version 4/);
});

test("validateReportV4 accepts a green LOCAL-WORLD-SMOKE-1 cell with complete evidence", () => {
  validateReportV4(validSmokeReportV4());
});

test("validateReportV4 rejects a green LOCAL-WORLD-SMOKE-1 cell with null evidence", () => {
  const report = validSmokeReportV4();
  report.results[0].evidence = null;
  assert.throws(() => validateReportV4(report), /requires complete evidence/);
});

test("validateReportV4 rejects an unknown evidence kind", () => {
  const report = validSmokeReportV4();
  (report.results[0].evidence as { kind: string }).kind = "some_other_kind";
  assert.throws(() => validateReportV4(report), /kind is unknown/);
});

test("validateReportV4 rejects an extra field on evidence or nested objects", () => {
  const report = validSmokeReportV4();
  (report.results[0].evidence as unknown as Record<string, unknown>).extra_field = "x";
  assert.throws(() => validateReportV4(report), /undeclared or missing field/);

  const nested = validSmokeReportV4();
  (smokeTurn(nested).litellm as unknown as Record<string, unknown>).extra = "x";
  assert.throws(() => validateReportV4(nested), /litellm has undeclared/);

  const cleanupExtra = validSmokeReportV4();
  ((cleanupExtra.results[0].evidence as LocalWorkspaceTurnEvidenceV1).cleanup as unknown as Record<string, unknown>).extra = "x";
  assert.throws(() => validateReportV4(cleanupExtra), /cleanup has undeclared/);
});

test("validateReportV4 rejects unsafe strings: paths and secret-like markers", () => {
  const leaked = validSmokeReportV4({ model_id: "/tmp/leaked-local-path" });
  assert.throws(() => validateReportV4(leaked), /model_id is missing or unsafe/);

  const traversal = validSmokeReportV4();
  (traversal.results[0].evidence as LocalWorkspaceTurnEvidenceV1).artifact_ids = ["server/../../etc/passwd"];
  assert.throws(() => validateReportV4(traversal), /artifact_ids\[0\] is missing or unsafe/);

  const redactedLooking = validSmokeReportV4();
  smokeTurn(redactedLooking).litellm.token_id_hash = "[REDACTED]";
  assert.throws(() => validateReportV4(redactedLooking), /token_id_hash must be a lowercase 64-hex digest/);
});

test("validateReportV4 rejects invalid or inconsistent token counts", () => {
  const mismatched = validSmokeReportV4();
  smokeTurn(mismatched).litellm.total_tokens = 999;
  assert.throws(() => validateReportV4(mismatched), /token counts are internally inconsistent/);

  const zero = validSmokeReportV4();
  smokeTurn(zero).litellm.prompt_tokens = 0;
  assert.throws(() => validateReportV4(zero), /prompt_tokens must be a positive integer/);

  const negative = validSmokeReportV4();
  smokeTurn(negative).litellm.completion_tokens = -1;
  assert.throws(() => validateReportV4(negative), /completion_tokens must be a positive integer/);
});

test("validateReportV4 rejects non-positive spend", () => {
  const zeroSpend = validSmokeReportV4();
  smokeTurn(zeroSpend).litellm.spend_usd = 0;
  assert.throws(() => validateReportV4(zeroSpend), /spend_usd must be positive/);

  const negativeSpend = validSmokeReportV4();
  smokeTurn(negativeSpend).litellm.spend_usd = -0.01;
  assert.throws(() => validateReportV4(negativeSpend), /spend_usd must be positive/);
});

test("validateReportV4 rejects unsorted/duplicate/oversized request_ids", () => {
  const unsorted = validSmokeReportV4();
  smokeTurn(unsorted).litellm.request_ids = ["req-2", "req-1"];
  assert.throws(() => validateReportV4(unsorted), /must be sorted ascending/);

  const duplicated = validSmokeReportV4();
  smokeTurn(duplicated).litellm.request_ids = ["req-1", "req-1"];
  assert.throws(() => validateReportV4(duplicated), /duplicate entry/);

  const oversized = validSmokeReportV4();
  smokeTurn(oversized).litellm.request_ids = Array.from({ length: 51 }, (_, i) => `req-${String(i).padStart(3, "0")}`);
  assert.throws(() => validateReportV4(oversized), /exceeds the bounded cap/);
});

test("validateReportV4 rejects a green cell whose cleanup has a false deletion flag or a failure", () => {
  const incomplete = validSmokeReportV4();
  smokeTurn(incomplete).cleanup.virtual_key_deleted = false;
  assert.throws(() => validateReportV4(incomplete), /incomplete on a green result/);

  const failed = validSmokeReportV4();
  (failed.results[0].evidence as LocalWorkspaceTurnEvidenceV1).cleanup.failed = 1;
  assert.throws(() => validateReportV4(failed), /cleanup.failed must be 0/);
});

test("validateReportV4 rejects transcript_reopened !== true and harness !== claude", () => {
  const notReopened = validSmokeReportV4();
  (notReopened.results[0].evidence as unknown as { transcript_reopened: boolean }).transcript_reopened = false;
  assert.throws(() => validateReportV4(notReopened), /transcript_reopened must be true/);

  // The cross-field cell binding (LQF-005) catches an evidence harness that
  // disagrees with the cell's harness dimension before the kind-scoped
  // "harness must be claude" structural check; either rejection is correct.
  const wrongHarness = validSmokeReportV4();
  (wrongHarness.results[0].evidence as unknown as { harness: string }).harness = "codex";
  assert.throws(
    () => validateReportV4(wrongHarness),
    /harness is "codex" but the cell's dimensions name harness "claude"/,
  );
});

test("sanitizeCellEvidence redacts secrets so validation then rejects the mangled value", () => {
  const secret = "sk-live-leaked";
  const evidence: CellEvidenceV1 = validCellEvidence({ model_id: `claude-haiku-4-5-${secret}` });
  const sanitized = sanitizeCellEvidence(evidence, [secret]);
  assert.ok(sanitized && sanitized.kind === "local_workspace_turn");
  assert.ok(sanitized.model_id.includes("[REDACTED]"));
  assert.throws(
    () =>
      validateReportV4(
        validSmokeReportV4({ model_id: sanitized.model_id }),
      ),
    /model_id is missing or unsafe/,
  );
  // A clean evidence object with no secret values is untouched.
  assert.deepEqual(sanitizeCellEvidence(validCellEvidence(), []), validCellEvidence());
  assert.equal(sanitizeCellEvidence(null, [secret]), null);
});

test("writeReportV4 sanitizes, validates, and writes a V4 artifact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-v4-"));
  try {
    const written = await writeReportV4(dir, validSmokeReportV4());
    const raw = await readFile(written, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schema_version, 4);
    assert.equal(parsed.results[0].evidence.kind, "local_workspace_turn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateReportV4 accepts a failed cell whose cleanup evidence records failed>0", () => {
  // The sibling green case (failed>0 on a green cell) is still rejected — see
  // "validateReportV4 rejects a green cell whose cleanup has a false deletion
  // flag or a failure" above. Here the same evidence is valid because the cell
  // is non-green and merely records its own cleanup failure.
  validateReportV4(failedCleanupSmokeReportV4());
});

test("writeReportV4 persists a failed cleanup-failure cell (exit 1, report written, not throw→exit 2)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-v4-"));
  try {
    const written = await writeReportV4(dir, failedCleanupSmokeReportV4());
    const parsed = JSON.parse(await readFile(written, "utf8"));
    assert.equal(parsed.schema_version, 4);
    assert.equal(parsed.results[0].status, "failed");
    assert.equal(parsed.results[0].evidence.cleanup.failed, 1);
    assert.equal(parsed.results[0].evidence.cleanup.virtual_key_deleted, false);
    // The report IS persisted with a real nonzero intended exit, so the CLI
    // returns exit 1 rather than throwing on write and returning exit 2.
    assert.equal(parsed.summary.intended_exit_code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeReportV4 refuses to persist evidence carrying a resolved secret", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-v4-"));
  try {
    const secret = "sk-live-leaked";
    const poisoned = validSmokeReportV4({ model_id: `claude-haiku-4-5-${secret}` });
    await assert.rejects(writeReportV4(dir, poisoned, [secret]), ReportValidationError);
    await assert.rejects(readFile(reportPath(dir, poisoned), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── PR 3 self-host evidence (validateSelfHostCellEvidence / sanitizeSelfHostCellEvidence) ──

function validSelfHostInstallClaimEvidence(
  overrides: Partial<SelfHostInstallClaimEvidenceV1> = {},
): SelfHostInstallClaimEvidenceV1 {
  return {
    kind: "selfhost_install_claim",
    artifact_ids: ["server/linux-amd64", "selfhost-bundle/linux-amd64", "anyharness/x86_64-unknown-linux-gnu", "desktop-renderer/browser"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "claude",
    api_origin: "sh-run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:8542",
    candidate_server_version: "0.3.27",
    server_version_matches_candidate: true,
    running_image_digest: "sha256:" + "d".repeat(64),
    bundle_sha256: "e".repeat(64),
    setup_token_hash: "f".repeat(64),
    owner_user_id_hash: "0".repeat(64),
    org_id_hash: "1".repeat(64),
    tls_verified: true,
    second_claim_rejected: true,
    restart_persisted: true,
    cleanup: {
      ledger_id_hash: "9".repeat(64),
      registered: 7,
      reconciled: 7,
      failed: 0,
      ec2_terminated: true,
      security_group_deleted: true,
      key_pair_deleted: true,
      route53_record_deleted: true,
      browser_closed: true,
      processes_stopped: true,
      local_paths_removed: true,
    },
    ...overrides,
  };
}

/** V4 report with one green SELFHOST-INSTALL-1 SH-INSTALL-CLAIM cell carrying complete evidence. */
function validSelfHostReportV4(
  evidenceOverrides: Partial<SelfHostInstallClaimEvidenceV1> = {},
): TestRunReportV4 {
  const report = validReportV4();
  const cellId = "SELFHOST-INSTALL-1/selfhost/cell=SH-INSTALL-CLAIM,harness=claude";
  report.selected_cells[0] = {
    ...report.selected_cells[0],
    cell_id: cellId,
    scenario_id: "SELFHOST-INSTALL-1",
    registry_flow_ref: "specs#SELFHOST-INSTALL-1",
    runtime_lane: "selfhost",
    dimensions: { cell: "SH-INSTALL-CLAIM", harness: "claude" },
  };
  report.results[0] = {
    ...report.results[0],
    cell_id: cellId,
    scenario_id: "SELFHOST-INSTALL-1",
    registry_flow_ref: "specs#SELFHOST-INSTALL-1",
    runtime_lane: "selfhost",
    dimensions: { cell: "SH-INSTALL-CLAIM", harness: "claude" },
    evidence: validSelfHostInstallClaimEvidence(evidenceOverrides),
  };
  return report;
}

// ── The four new local-functional evidence kinds (audit ruling #3 / BRIEF §3) ──

const CLEANUP_OK: LocalCleanupV1 = {
  ledger_id_hash: "d".repeat(64),
  registered: 8,
  reconciled: 8,
  failed: 0,
  virtual_key_deleted: true,
  litellm_subjects_deleted: true,
  browser_closed: true,
  processes_stopped: true,
  containers_removed: true,
  local_paths_removed: true,
};

const SPEND_OK: LocalLitellmSpendV1 = {
  token_id_hash: "c".repeat(64),
  request_ids: ["req-1", "req-2"],
  window_started_at: "2026-07-14T00:00:00Z",
  window_finished_at: "2026-07-14T00:00:10Z",
  prompt_tokens: 10,
  completion_tokens: 3,
  total_tokens: 13,
  spend_usd: 0.0004,
};

/**
 * A world-backed (`candidate_build` non-null) V4 report with a single result
 * for `scenarioId`/`dimensions`, carrying `evidence` and defaulting to a
 * green `runtime_lane: "local"` result — the shape
 * `LOCAL_FUNCTIONAL_EVIDENCE_SCENARIOS` requires complete evidence for.
 */
function worldBackedLocalReportV4(
  scenarioId: string,
  dimensions: Record<string, string>,
  evidence: CellEvidenceV1 | null,
  resultOverrides: Partial<FinalCellResultV2> = {},
): TestRunReportV4 {
  const report = validReportV4();
  report.candidate_build = STRICT_CB;
  const cellId = canonicalCellId(scenarioId, "local", dimensions);
  report.selected_cells[0] = {
    ...report.selected_cells[0],
    cell_id: cellId,
    scenario_id: scenarioId,
    registry_flow_ref: `specs#${scenarioId}`,
    dimensions,
  };
  report.results[0] = {
    ...report.results[0],
    cell_id: cellId,
    scenario_id: scenarioId,
    registry_flow_ref: `specs#${scenarioId}`,
    dimensions,
    evidence,
    ...resultOverrides,
  };
  return report;
}

test("validateReportV4 accepts a green SELFHOST-INSTALL-1 cell with complete self-host evidence", () => {
  validateReportV4(validSelfHostReportV4());
});

test("validateReportV4 rejects a green SELFHOST-INSTALL-1 cell with null evidence", () => {
  const report = validSelfHostReportV4();
  report.results[0].evidence = null;
  assert.throws(() => validateReportV4(report), /requires complete evidence/);
});

test("validateReportV4 rejects self-host evidence with an unknown kind", () => {
  const report = validSelfHostReportV4();
  (report.results[0].evidence as { kind: string }).kind = "selfhost_unknown_kind";
  // The per-cell (scenario_id, cell) kind binding (PR7-CONTROL-007) rejects the
  // mismatch before the kind-dispatch's own "kind is unknown" — either way the
  // unknown kind is fail-closed, which is what this asserts.
  assert.throws(() => validateReportV4(report), /kind is unknown|requires "selfhost_install_claim"/);
});

test("validateReportV4 rejects self-host evidence with an undeclared extra field", () => {
  const report = validSelfHostReportV4();
  (report.results[0].evidence as unknown as Record<string, unknown>).extra_field = "x";
  assert.throws(() => validateReportV4(report), /undeclared or missing field/);

  const cleanupExtra = validSelfHostReportV4();
  (cleanupExtra.results[0].evidence as unknown as { cleanup: Record<string, unknown> }).cleanup.extra = "x";
  assert.throws(() => validateReportV4(cleanupExtra), /cleanup has undeclared/);
});

test("validateReportV4 rejects api_origin === controller_runtime_origin (never implies AnyHarness ran on the box)", () => {
  const report = validSelfHostReportV4({ controller_runtime_origin: "sh-run-1.qualification.proliferate.com" });
  assert.throws(() => validateReportV4(report), /must be distinct/);
});

test("validateReportV4 rejects unsafe self-host string fields", () => {
  const leaked = validSelfHostReportV4({ running_image_digest: "/tmp/leaked-local-path" });
  assert.throws(() => validateReportV4(leaked), /running_image_digest is missing or unsafe/);

  const redactedHash = validSelfHostReportV4({ setup_token_hash: "[REDACTED]" });
  assert.throws(() => validateReportV4(redactedHash), /setup_token_hash must be a lowercase 64-hex digest/);
});

test("validateReportV4 rejects a false witness boolean on self-host evidence", () => {
  const report = validSelfHostReportV4();
  (report.results[0].evidence as unknown as { tls_verified: boolean }).tls_verified = false;
  assert.throws(() => validateReportV4(report), /tls_verified must be true/);
});

test("validateReportV4 rejects a green self-host cell whose cleanup has a false deletion flag or a failure", () => {
  const incomplete = validSelfHostReportV4({
    cleanup: { ...validSelfHostInstallClaimEvidence().cleanup, ec2_terminated: false },
  });
  assert.throws(() => validateReportV4(incomplete), /incomplete on a green result/);

  const failed = validSelfHostReportV4({
    cleanup: { ...validSelfHostInstallClaimEvidence().cleanup, failed: 1 },
  });
  assert.throws(() => validateReportV4(failed), /cleanup.failed must be 0/);
});

/** A base-turn report with the given cell status + provider-absence claims. */
function selfHostBaseTurnReportV4(
  status: "green" | "expected_fail",
  claim: "unproven" | "observed_absent",
): TestRunReportV4 {
  const report = validSelfHostReportV4();
  const cellId = "SELFHOST-INSTALL-1/selfhost/cell=SH-BASE-TURN,harness=claude";
  const evidence: SelfHostBaseTurnEvidenceV1 = {
    kind: "selfhost_base_turn",
    artifact_ids: ["server/linux-amd64"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "claude",
    api_origin: "sh-run-1.qualification.proliferate.com",
    controller_runtime_origin: "127.0.0.1:8542",
    model_id: "claude-haiku-4-5",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    transcript_reopened: true,
    byok_route: "api_key",
    byok_key_id_hash: "c".repeat(64),
    no_litellm_spend: claim,
    no_e2b: claim,
    cleanup: validSelfHostInstallClaimEvidence().cleanup,
  };
  const dims = { cell: "SH-BASE-TURN", harness: "claude" };
  report.selected_cells[0] = { ...report.selected_cells[0], cell_id: cellId, dimensions: dims };
  const reason =
    status === "expected_fail" ? { code: "known_gap" as const, message: "provider-absence unproven" } : null;
  report.results[0] = { ...report.results[0], cell_id: cellId, dimensions: dims, status, reason, evidence };
  // Keep summary.by_status consistent with the single result's status.
  report.summary.by_status.green = status === "green" ? 1 : 0;
  report.summary.by_status.expected_fail = status === "expected_fail" ? 1 : 0;
  report.verdict.reasons = expectedVerdict(report).reasons;
  return report;
}

test("validateReportV4 REJECTS a GREEN SH-BASE-TURN with unproven provider-absence claims (PR7-CONTROL-010)", () => {
  assert.throws(
    () => validateReportV4(selfHostBaseTurnReportV4("green", "unproven")),
    /no_litellm_spend is "unproven" on a GREEN result/,
  );
});

test("validateReportV4 accepts an EXPECTED_FAIL SH-BASE-TURN with unproven claims (honest gap, PR7-CONTROL-010)", () => {
  validateReportV4(selfHostBaseTurnReportV4("expected_fail", "unproven"));
});

test("validateReportV4 accepts a GREEN SH-BASE-TURN once provider absence is observed_absent (PR7-CONTROL-010)", () => {
  validateReportV4(selfHostBaseTurnReportV4("green", "observed_absent"));
});

test("validateReportV4 accepts a failed self-host cell whose cleanup evidence records failed>0", () => {
  const report = validSelfHostReportV4({
    cleanup: { ...validSelfHostInstallClaimEvidence().cleanup, failed: 1, ec2_terminated: false },
  });
  report.run.behavior = "strict";
  report.candidate_build = STRICT_CB;
  report.results[0].status = "failed";
  report.results[0].reason = { code: "scenario_failure", message: "world cleanup did not fully reconcile (failed=1)" };
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.failed = 1;
  report.summary.by_status = byStatus;
  report.summary.intended_exit_code = 1;
  report.verdict.status = "selected_cells_failed";
  withDerivedReasons(report as unknown as TestRunReportV3);
  validateReportV4(report);
});

function validRouteTurnEvidence(overrides: Partial<LocalRouteTurnEvidenceV1> = {}): LocalRouteTurnEvidenceV1 {
  return {
    kind: "local_route_turn",
    journey: "LOCAL-2",
    artifact_ids: ["server/linux-x64", "anyharness/aarch64-apple-darwin"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "codex",
    route: "gateway",
    model_id: "claude-haiku-4-5",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    transcript_reopened: true,
    gateway_spend: { ...SPEND_OK },
    user_key_isolation: null,
    route_change: null,
    billing_reconcile_deferred: true,
    cleanup: { ...CLEANUP_OK },
    ...overrides,
  };
}

function userKeyRouteTurnEvidence(
  overrides: Partial<LocalRouteTurnEvidenceV1> = {},
): LocalRouteTurnEvidenceV1 {
  return validRouteTurnEvidence({
    journey: "LOCAL-3",
    route: "user_key",
    gateway_spend: null,
    user_key_isolation: { litellm_spend_rows: 0, managed_balance_read_deferred: true },
    ...overrides,
  });
}

test("validateReportV4 accepts a valid local_route_turn gateway-route cell (LOCAL-2)", () => {
  const report = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence(),
  );
  validateReportV4(report);
});

test("validateReportV4 accepts a valid local_route_turn user-key-route cell (LOCAL-3)", () => {
  const report = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex", journey: "LOCAL-3" },
    userKeyRouteTurnEvidence(),
  );
  validateReportV4(report);
});

test("validateReportV4 accepts a valid local_route_turn LOCAL-6 route-change cell", () => {
  const report = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    // The canonical LOCAL-6 cell is keyed by the route-change dimension, not a
    // harness; the binding derives journey=LOCAL-6 from route=change.
    { route: "change" },
    userKeyRouteTurnEvidence({
      journey: "LOCAL-6",
      route_change: {
        original_route: "user_key",
        original_session_id_hash: "e".repeat(64),
        new_route: "gateway",
        new_session_id_hash: "f".repeat(64),
      },
    }),
  );
  validateReportV4(report);
});

test("validateReportV4 rejects local_route_turn undeclared/missing fields", () => {
  const evidence = validRouteTurnEvidence() as unknown as Record<string, unknown>;
  evidence.extra_field = "x";
  const report = worldBackedLocalReportV4("T3-CHAT-1", { harness: "codex" }, evidence as unknown as CellEvidenceV1);
  assert.throws(() => validateReportV4(report), /undeclared or missing field/);
});

test("validateReportV4 rejects local_route_turn gateway route with mismatched spend/isolation", () => {
  const missingSpend = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ gateway_spend: null }),
  );
  assert.throws(() => validateReportV4(missingSpend), /gateway_spend must be non-null/);

  const strayIsolation = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ user_key_isolation: { litellm_spend_rows: 0, managed_balance_read_deferred: true } }),
  );
  assert.throws(() => validateReportV4(strayIsolation), /user_key_isolation must be null/);
});

test("validateReportV4 rejects local_route_turn user-key route with mismatched spend/isolation", () => {
  const missingIsolation = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex", journey: "LOCAL-3" },
    userKeyRouteTurnEvidence({ user_key_isolation: null }),
  );
  assert.throws(() => validateReportV4(missingIsolation), /user_key_isolation must be non-null/);

  const straySpend = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex", journey: "LOCAL-3" },
    userKeyRouteTurnEvidence({ gateway_spend: { ...SPEND_OK } }),
  );
  assert.throws(() => validateReportV4(straySpend), /gateway_spend must be null/);
});

test("validateReportV4 rejects local_route_turn non-zero user-key isolation counters", () => {
  const nonZeroRows = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex" },
    userKeyRouteTurnEvidence({
      user_key_isolation: { litellm_spend_rows: 1, managed_balance_read_deferred: true } as unknown as {
        litellm_spend_rows: 0;
        managed_balance_read_deferred: true;
      },
    }),
  );
  assert.throws(() => validateReportV4(nonZeroRows), /litellm_spend_rows must be 0/);

  // LQF-006: the balance is never read here, so the deferral marker must be
  // true — a fabricated false (claiming an observed balance read) is rejected.
  const claimsBalanceRead = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex" },
    userKeyRouteTurnEvidence({
      user_key_isolation: { litellm_spend_rows: 0, managed_balance_read_deferred: false } as unknown as {
        litellm_spend_rows: 0;
        managed_balance_read_deferred: true;
      },
    }),
  );
  assert.throws(() => validateReportV4(claimsBalanceRead), /managed_balance_read_deferred must be true/);
});

test("validateReportV4 rejects local_route_turn route_change presence mismatched with journey", () => {
  const strayRouteChange = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({
      route_change: {
        original_route: "user_key",
        original_session_id_hash: "e".repeat(64),
        new_route: "gateway",
        new_session_id_hash: "f".repeat(64),
      },
    }),
  );
  assert.throws(() => validateReportV4(strayRouteChange), /route_change must be null outside journey "LOCAL-6"/);

  const missingRouteChange = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { route: "change" },
    userKeyRouteTurnEvidence({ journey: "LOCAL-6", route_change: null }),
  );
  assert.throws(
    () => validateReportV4(missingRouteChange),
    /route_change must be non-null for journey "LOCAL-6"/,
  );
});

test("validateReportV4 rejects local_route_turn invalid journey/route enums", () => {
  const badJourney = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ journey: "LOCAL-9" as LocalRouteTurnEvidenceV1["journey"] }),
  );
  assert.throws(() => validateReportV4(badJourney), /journey must be one of/);

  const badRoute = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ route: "direct" as LocalRouteTurnEvidenceV1["route"] }),
  );
  assert.throws(() => validateReportV4(badRoute), /route must be one of/);
});

test("validateReportV4 rejects local_route_turn billing_reconcile_deferred !== true", () => {
  const report = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ billing_reconcile_deferred: false as unknown as true }),
  );
  assert.throws(() => validateReportV4(report), /billing_reconcile_deferred must be true/);
});

test("validateReportV4 accepts a failed local_route_turn cell recording its own cleanup failure", () => {
  const report = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ cleanup: { ...CLEANUP_OK, failed: 1, virtual_key_deleted: false } }),
    { status: "failed", reason: { code: "scenario_failure", message: "cleanup did not fully reconcile" } },
  );
  report.summary.by_status = { ...report.summary.by_status, green: 0, failed: 1 };
  report.run.behavior = "strict";
  report.verdict.status = "selected_cells_failed";
  report.summary.intended_exit_code = 1;
  withDerivedReasons(report as unknown as TestRunReportV3);
  validateReportV4(report);
});

test("sanitizeCellEvidence redacts secrets in self-host evidence so validation then rejects the mangled value", () => {
  const secret = "sk-ant-live-leaked";
  const evidence: CellEvidenceV1 = validSelfHostInstallClaimEvidence({
    running_image_digest: `sha256:leaked-${secret}`,
  });
  const sanitized = sanitizeCellEvidence(evidence, [secret]);
  assert.ok(sanitized && "running_image_digest" in sanitized && sanitized.running_image_digest.includes("[REDACTED]"));
  assert.throws(
    () =>
      validateReportV4(
        validSelfHostReportV4({ running_image_digest: (sanitized as SelfHostInstallClaimEvidenceV1).running_image_digest }),
      ),
    /running_image_digest is missing or unsafe/,
  );
  assert.deepEqual(sanitizeCellEvidence(validSelfHostInstallClaimEvidence(), []), validSelfHostInstallClaimEvidence());
});

test("writeReportV4 writes a SELFHOST-INSTALL-1 artifact with self-host evidence intact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-v4-selfhost-"));
  try {
    const written = await writeReportV4(dir, validSelfHostReportV4());
    const raw = await readFile(written, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schema_version, 4);
    assert.equal(parsed.results[0].evidence.kind, "selfhost_install_claim");
    assert.equal(parsed.results[0].evidence.api_origin, "sh-run-1.qualification.proliferate.com");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function validConfigMatrixEvidence(
  overrides: Partial<LocalConfigMatrixEvidenceV1> = {},
): LocalConfigMatrixEvidenceV1 {
  return {
    kind: "local_config_matrix",
    artifact_ids: ["server/linux-x64"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "grok",
    model_id: "grok-code-fast-1",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    controls: [
      { control_key: "reasoning_effort", accepted_value: "medium", rejected: false },
      { control_key: "mode", accepted_value: "plan", rejected: false },
    ],
    known_1063_expected_fail: false,
    cleanup: { ...CLEANUP_OK },
    ...overrides,
  };
}

// ── cloud_provision_turn evidence (PR 2, spec step 10) ──────────────────────
// Append-only per the extension contract: these tests exercise only the
// kind-scoped cloud validator/sanitizer added to schema.ts; none of the
// LOCAL-WORLD-SMOKE-1/local_workspace_turn tests above are touched.

function validCloudCellEvidence(overrides: Partial<CloudProvisionTurnEvidenceV1> = {}): CloudProvisionTurnEvidenceV1 {
  return {
    kind: "cloud_provision_turn",
    artifact_ids: [
      "server/linux/amd64",
      "anyharness/x86_64-unknown-linux-musl",
      "worker/x86_64-unknown-linux-musl",
      "supervisor/x86_64-unknown-linux-musl",
      "credential-helper/x86_64-unknown-linux-musl",
      "desktop-renderer/browser",
      "e2b-template/cloud-run-1",
      "candidate-api/cloud-run-1.qualification.proliferate.com",
    ],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    worker_version: "0.3.27",
    supervisor_version: "0.3.27",
    harness: "claude",
    model_id: "claude-haiku-4-5",
    template: {
      template_id: "tmpl_123",
      build_id: "build_456",
      input_hash: "a".repeat(64),
    },
    sandbox_id_hash: "b".repeat(64),
    worker: {
      supervisor_is_parent: true,
      heartbeat_recent: true,
    },
    covered_repo: {
      name: "proliferate-e2e/e2e-fixture",
      commit: "c".repeat(40),
      no_credential_in_remote: true,
    },
    isolation: {
      actor_b_denied: true,
      runtime_rejects_missing: true,
      runtime_rejects_actor_b: true,
    },
    litellm: {
      token_id_hash: "d".repeat(64),
      request_ids: ["req-1", "req-2"],
      window_started_at: "2026-07-14T00:00:00Z",
      window_finished_at: "2026-07-14T00:00:10Z",
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
      spend_usd: 0.0004,
    },
    cleanup: {
      ledger_id_hash: "e".repeat(64),
      registered: 12,
      reconciled: 12,
      failed: 0,
      sandboxes_deleted: true,
      template_deleted: true,
      dns_record_deleted: true,
      ec2_terminated: true,
      security_group_deleted: true,
      key_pair_deleted: true,
      virtual_key_deleted: true,
      litellm_subjects_deleted: true,
      local_paths_removed: true,
    },
    ...overrides,
  };
}

test("validateReportV4 accepts a valid local_config_matrix cell", () => {
  const report = worldBackedLocalReportV4("T3-CFG-1", { harness: "grok" }, validConfigMatrixEvidence());
  validateReportV4(report);
});

test("validateReportV4 rejects local_config_matrix with an empty controls array", () => {
  const report = worldBackedLocalReportV4(
    "T3-CFG-1",
    { harness: "grok" },
    validConfigMatrixEvidence({ controls: [] }),
  );
  assert.throws(() => validateReportV4(report), /controls must be a non-empty array/);
});

test("validateReportV4 rejects local_config_matrix control with an undeclared field", () => {
  const controls = [
    { control_key: "mode", accepted_value: "plan", rejected: false, extra: "x" } as unknown as {
      control_key: string;
      accepted_value: string;
      rejected: boolean;
    },
  ];
  const report = worldBackedLocalReportV4(
    "T3-CFG-1",
    { harness: "grok" },
    validConfigMatrixEvidence({ controls }),
  );
  assert.throws(() => validateReportV4(report), /controls\[0\] has undeclared or missing field/);
});

test("validateReportV4 rejects a green local_config_matrix cell with known_1063_expected_fail true", () => {
  const report = worldBackedLocalReportV4(
    "T3-CFG-1",
    { harness: "grok" },
    validConfigMatrixEvidence({ known_1063_expected_fail: true }),
  );
  assert.throws(() => validateReportV4(report), /known_1063_expected_fail cannot be true on a green result/);
});

test("validateReportV4 accepts known_1063_expected_fail true on a non-green local_config_matrix cell", () => {
  const report = worldBackedLocalReportV4(
    "T3-CFG-1",
    { harness: "grok" },
    validConfigMatrixEvidence({ known_1063_expected_fail: true }),
    { status: "expected_fail", reason: { code: "known_gap", message: "known #1063 rejection" } },
  );
  report.summary.by_status = { ...report.summary.by_status, green: 0, expected_fail: 1 };
  report.run.behavior = "strict";
  report.verdict.status = "selected_cells_failed";
  report.summary.intended_exit_code = 1;
  withDerivedReasons(report as unknown as TestRunReportV3);
  validateReportV4(report);
});

/** V4 report with one green CLOUD-PROVISION-1 cell carrying complete evidence. */
function validCloudReportV4(evidenceOverrides: Partial<CloudProvisionTurnEvidenceV1> = {}): TestRunReportV4 {
  const report = validReportV4();
  report.selected_cells[0] = {
    ...report.selected_cells[0],
    cell_id: "CLOUD-PROVISION-1/sandbox/harness=claude",
    scenario_id: "CLOUD-PROVISION-1",
    registry_flow_ref: "specs#CLOUD-PROVISION-1",
    runtime_lane: "sandbox",
    dimensions: { harness: "claude" },
  };
  report.results[0] = {
    ...report.results[0],
    cell_id: "CLOUD-PROVISION-1/sandbox/harness=claude",
    scenario_id: "CLOUD-PROVISION-1",
    registry_flow_ref: "specs#CLOUD-PROVISION-1",
    runtime_lane: "sandbox",
    dimensions: { harness: "claude" },
    evidence: validCloudCellEvidence(evidenceOverrides),
  };
  return report;
}

test("validateReportV4 accepts a green CLOUD-PROVISION-1 cell with complete cloud_provision_turn evidence", () => {
  validateReportV4(validCloudReportV4());
});

test("validateReportV4 rejects a green CLOUD-PROVISION-1 cell with null evidence", () => {
  const report = validCloudReportV4();
  report.results[0].evidence = null;
  assert.throws(() => validateReportV4(report), /requires complete evidence/);
});

test("validateReportV4 rejects an extra field on cloud evidence or a nested cloud object", () => {
  const report = validCloudReportV4();
  (report.results[0].evidence as unknown as Record<string, unknown>).extra_field = "x";
  assert.throws(() => validateReportV4(report), /undeclared or missing field/);

  const templateExtra = validCloudReportV4();
  (templateExtra.results[0].evidence as CloudProvisionTurnEvidenceV1 as unknown as Record<string, unknown>);
  ((templateExtra.results[0].evidence as CloudProvisionTurnEvidenceV1).template as unknown as Record<string, unknown>).extra = "x";
  assert.throws(() => validateReportV4(templateExtra), /template has undeclared/);

  const isolationExtra = validCloudReportV4();
  ((isolationExtra.results[0].evidence as CloudProvisionTurnEvidenceV1).isolation as unknown as Record<string, unknown>).extra = "x";
  assert.throws(() => validateReportV4(isolationExtra), /isolation has undeclared/);

  const cleanupExtra = validCloudReportV4();
  ((cleanupExtra.results[0].evidence as CloudProvisionTurnEvidenceV1).cleanup as unknown as Record<string, unknown>).extra = "x";
  assert.throws(() => validateReportV4(cleanupExtra), /cleanup has undeclared/);
});

test("validateReportV4 rejects a cloud template.input_hash / sandbox_id_hash that is not 64-hex", () => {
  const badTemplateHash = validCloudReportV4({
    template: { template_id: "tmpl_123", build_id: "build_456", input_hash: "not-a-hash" },
  });
  assert.throws(() => validateReportV4(badTemplateHash), /input_hash must be a lowercase 64-hex digest/);

  const badSandboxHash = validCloudReportV4({ sandbox_id_hash: "not-a-hash" });
  assert.throws(() => validateReportV4(badSandboxHash), /sandbox_id_hash must be a lowercase 64-hex digest/);
});

test("validateReportV4 rejects a cloud covered_repo.commit that is not a full 40-hex sha", () => {
  const report = validCloudReportV4({
    covered_repo: { name: "proliferate-e2e/e2e-fixture", commit: "short-sha", no_credential_in_remote: true },
  });
  assert.throws(() => validateReportV4(report), /commit must be a full lowercase 40-hex sha/);
});

test("validateReportV4 accepts either supervisor_is_parent value (PR 9 owns parentage)", () => {
  // Supervisor-parentage is deferred to PR 9; PR 2 records the honest current
  // state as a boolean rather than gating on it. A non-boolean is still rejected.
  assert.doesNotThrow(() =>
    validateReportV4(validCloudReportV4({ worker: { supervisor_is_parent: false, heartbeat_recent: true } })),
  );
  const badType = validCloudReportV4({
    worker: { supervisor_is_parent: "yes" as unknown as boolean, heartbeat_recent: true },
  });
  assert.throws(() => validateReportV4(badType), /supervisor_is_parent must be a boolean/);
});

test("validateReportV4 rejects false covered_repo/isolation proofs on cloud evidence", () => {
  const repo = validCloudReportV4({
    covered_repo: { name: "proliferate-e2e/e2e-fixture", commit: "c".repeat(40), no_credential_in_remote: false as unknown as true },
  });
  assert.throws(() => validateReportV4(repo), /no_credential_in_remote must be true/);

  const isolation = validCloudReportV4({
    isolation: { actor_b_denied: true, runtime_rejects_missing: false as unknown as true, runtime_rejects_actor_b: true },
  });
  assert.throws(() => validateReportV4(isolation), /runtime_rejects_missing must be true/);
});

test("validateReportV4 rejects a green cloud cell whose cleanup has a false deletion flag or a failure", () => {
  const failed = validCloudReportV4({ cleanup: { ...validCloudCellEvidence().cleanup, failed: 1 } });
  assert.throws(() => validateReportV4(failed), /cleanup\.failed must be 0/);

  const incomplete = validCloudReportV4({
    cleanup: { ...validCloudCellEvidence().cleanup, sandboxes_deleted: false },
  });
  assert.throws(() => validateReportV4(incomplete), /cleanup is incomplete/);
});

test("validateReportV4 reuses the shared litellm invariant checks for cloud evidence", () => {
  const report = validCloudReportV4({
    litellm: { ...validCloudCellEvidence().litellm, prompt_tokens: 10, completion_tokens: 3, total_tokens: 999 },
  });
  assert.throws(() => validateReportV4(report), /token counts are internally inconsistent/);
});

test("validateReportV4 accepts a failed CLOUD-PROVISION-1 cell whose cleanup evidence records its own failure", () => {
  const report = validCloudReportV4({ cleanup: { ...validCloudCellEvidence().cleanup, failed: 1, sandboxes_deleted: false } });
  report.run.behavior = "strict";
  report.candidate_build = STRICT_CB;
  report.results[0] = {
    ...report.results[0],
    status: "failed",
    reason: { code: "scenario_failure", message: "cleanup did not fully reconcile (failed=1)" },
  };
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.failed = 1;
  report.summary.by_status = byStatus;
  report.summary.intended_exit_code = 1;
  report.verdict.status = "selected_cells_failed";
  withDerivedReasons(report as unknown as TestRunReportV3);
  validateReportV4(report);
});

test("validateReportV4 rejects local_config_matrix harness outside the closed catalog set", () => {
  const report = worldBackedLocalReportV4(
    "T3-CFG-1",
    { harness: "gpt5" },
    validConfigMatrixEvidence({ harness: "gpt5" as LocalConfigMatrixEvidenceV1["harness"] }),
  );
  assert.throws(() => validateReportV4(report), /harness must be one of/);
});

function validSessionTabsEvidence(
  overrides: Partial<LocalSessionTabsEvidenceV1> = {},
): LocalSessionTabsEvidenceV1 {
  return {
    kind: "local_session_tabs",
    artifact_ids: ["server/linux-x64"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "claude",
    workspace_id_hash: "a".repeat(64),
    empty_switch_session_replaced: true,
    messaged_switch_new_tab: true,
    same_harness_model_change_in_session: true,
    reload_preserved: true,
    session_id_hashes: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
    cleanup: { ...CLEANUP_OK },
    ...overrides,
  };
}

test("validateReportV4 accepts a valid local_session_tabs cell", () => {
  const report = worldBackedLocalReportV4("T3-SESSION-1", {}, validSessionTabsEvidence());
  validateReportV4(report);
});

for (const flag of [
  "empty_switch_session_replaced",
  "messaged_switch_new_tab",
  "same_harness_model_change_in_session",
  "reload_preserved",
] as const) {
  test(`validateReportV4 rejects local_session_tabs with ${flag} !== true`, () => {
    const report = worldBackedLocalReportV4(
      "T3-SESSION-1",
      {},
      validSessionTabsEvidence({ [flag]: false } as Partial<LocalSessionTabsEvidenceV1>),
    );
    assert.throws(() => validateReportV4(report), new RegExp(`${flag} must be true`));
  });
}

test("validateReportV4 rejects local_session_tabs empty or duplicate session_id_hashes", () => {
  const empty = worldBackedLocalReportV4(
    "T3-SESSION-1",
    {},
    validSessionTabsEvidence({ session_id_hashes: [] }),
  );
  assert.throws(() => validateReportV4(empty), /session_id_hashes must be a non-empty array/);

  const duplicate = worldBackedLocalReportV4(
    "T3-SESSION-1",
    {},
    validSessionTabsEvidence({ session_id_hashes: ["b".repeat(64), "b".repeat(64)] }),
  );
  assert.throws(() => validateReportV4(duplicate), /session_id_hashes has a duplicate entry/);
});

function validMcpIntegrationEvidence(
  overrides: Partial<LocalMcpIntegrationEvidenceV1> = {},
): LocalMcpIntegrationEvidenceV1 {
  return {
    kind: "local_mcp_integration",
    artifact_ids: ["server/linux-x64"],
    server_version: "0.3.27",
    anyharness_version: "0.3.27",
    harness: "opencode",
    model_id: "claude-haiku-4-5",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    integration_namespace: "exa",
    tool_name: "exa_search",
    audit_event_id_hash: "c".repeat(64),
    audit_ok: true,
    cleanup: { ...CLEANUP_OK },
    ...overrides,
  };
}

test("validateReportV4 accepts a valid local_mcp_integration cell", () => {
  const report = worldBackedLocalReportV4("T3-INT-1", { harness: "opencode" }, validMcpIntegrationEvidence());
  validateReportV4(report);
});

test("validateReportV4 rejects local_mcp_integration audit_ok !== true", () => {
  const report = worldBackedLocalReportV4(
    "T3-INT-1",
    { harness: "opencode" },
    validMcpIntegrationEvidence({ audit_ok: false as unknown as true }),
  );
  assert.throws(() => validateReportV4(report), /audit_ok must be true/);
});

test("validateReportV4 rejects local_mcp_integration unsafe namespace/tool_name", () => {
  const badNamespace = worldBackedLocalReportV4(
    "T3-INT-1",
    { harness: "opencode" },
    validMcpIntegrationEvidence({ integration_namespace: "../escape" }),
  );
  assert.throws(() => validateReportV4(badNamespace), /integration_namespace is missing or unsafe/);

  const badTool = worldBackedLocalReportV4(
    "T3-INT-1",
    { harness: "opencode" },
    validMcpIntegrationEvidence({ tool_name: "" }),
  );
  assert.throws(() => validateReportV4(badTool), /tool_name is missing or unsafe/);
});

test("validateReportV4 rejects local_mcp_integration a malformed audit_event_id_hash", () => {
  const report = worldBackedLocalReportV4(
    "T3-INT-1",
    { harness: "opencode" },
    validMcpIntegrationEvidence({ audit_event_id_hash: "not-a-hash" }),
  );
  assert.throws(() => validateReportV4(report), /audit_event_id_hash must be a lowercase 64-hex digest/);
});

test("validateReportV4 rejects a green cell of a LOCAL_FUNCTIONAL_EVIDENCE_SCENARIOS scenario with null evidence in a world-backed run", () => {
  const report = worldBackedLocalReportV4("T3-CFG-1", { harness: "grok" }, null);
  assert.throws(() => validateReportV4(report), /requires complete evidence/);
});

// ── LQF-005: cross-field evidence↔cell binding ──────────────────────────────

test("LQF-005 (a): structurally valid evidence of the WRONG kind for the scenario is rejected", () => {
  // A T3-SESSION cell carrying a structurally valid local_route_turn object
  // (right shape, wrong scenario) must fail closed on the scenario→kind bind.
  const report = worldBackedLocalReportV4("T3-SESSION-1", { harness: "codex" }, validRouteTurnEvidence({ harness: "codex" }));
  assert.throws(
    () => validateReportV4(report),
    /kind is "local_route_turn" but T3-SESSION-1 requires "local_session_tabs"/,
  );
});

test("LQF-005 (b): AUTHROUTE journey must match the cell's route dimension", () => {
  // A user-key (per-harness, LOCAL-3) cell carrying LOCAL-6 journey evidence.
  const asL6 = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { harness: "codex" },
    userKeyRouteTurnEvidence({ journey: "LOCAL-6" }),
  );
  assert.throws(() => validateReportV4(asL6), /journey is "LOCAL-6" but the cell's dimensions .* require "LOCAL-3"/);

  // A route-change (LOCAL-6) cell carrying LOCAL-3 journey evidence.
  const asL3 = worldBackedLocalReportV4(
    "T3-AUTHROUTE-1",
    { route: "change" },
    userKeyRouteTurnEvidence({ journey: "LOCAL-3", route_change: null }),
  );
  assert.throws(() => validateReportV4(asL3), /journey is "LOCAL-3" but the cell's dimensions .* require "LOCAL-6"/);
});

test("LQF-005 (c): evidence harness disagreeing with the cell's harness dimension is rejected", () => {
  const report = worldBackedLocalReportV4("T3-INT-1", { harness: "opencode" }, validMcpIntegrationEvidence({ harness: "grok" }));
  assert.throws(
    () => validateReportV4(report),
    /harness is "grok" but the cell's dimensions name harness "opencode"/,
  );
});

test("LQF-005 (d): artifact_ids naming an artifact outside the report's candidate_build are rejected", () => {
  const report = worldBackedLocalReportV4(
    "T3-CHAT-1",
    { harness: "codex" },
    validRouteTurnEvidence({ artifact_ids: ["server/linux-x64", "server/some-other-build"] }),
  );
  assert.throws(
    () => validateReportV4(report),
    /artifact_ids names "server\/some-other-build", which is not an artifact of this report's candidate_build/,
  );
});

test("validateReportV4 exempts the diagnostic (non-world-backed) path from complete-evidence requirements", () => {
  const report = worldBackedLocalReportV4("T3-CFG-1", { harness: "grok" }, null);
  report.candidate_build = null;
  validateReportV4(report);
});

test("sanitizeCellEvidence redacts secrets in cloud evidence so validation then rejects the mangled value", () => {
  const secret = "sk-live-cloud-leaked";
  const evidence = validCloudCellEvidence({ model_id: `claude-haiku-4-5-${secret}` });
  const sanitized = sanitizeCellEvidence(evidence, [secret]) as CloudProvisionTurnEvidenceV1;
  assert.match(sanitized.model_id, /\[REDACTED\]/);
  assert.throws(() => validateReportV4(validCloudReportV4({ model_id: sanitized.model_id })), /is missing or unsafe/);
});

test("sanitizeCellEvidence does not touch local_workspace_turn evidence when sanitizing a cloud kind", () => {
  const localEvidence = validCellEvidence();
  const sanitizedLocal = sanitizeCellEvidence(localEvidence, ["unrelated-secret"]);
  assert.deepEqual(sanitizedLocal, localEvidence);
});

test("writeReportV4 persists a green CLOUD-PROVISION-1 cell with complete cloud_provision_turn evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-v4-cloud-"));
  try {
    const written = await writeReportV4(dir, validCloudReportV4());
    const parsed = JSON.parse(await readFile(written, "utf8"));
    assert.equal(parsed.schema_version, 4);
    assert.equal(parsed.results[0].evidence.kind, "cloud_provision_turn");
    assert.equal(parsed.results[0].evidence.cleanup.failed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
