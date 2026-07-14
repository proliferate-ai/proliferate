import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertNoSecretsInIdentity,
  boundMessage,
  redactExternalPayloads,
  redactSecrets,
  redactUrlCredentials,
  ReportValidationError,
  validateReport,
  type TestRunReportV3,
} from "./schema.js";
import { reportPath, ReportWriteError, writeReport } from "./write.js";
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


// Minimal valid candidate evidence for strict-report tests (strict requires
// non-null candidate_build per CBH-001).
const STRICT_CB: TestRunReportV3["candidate_build"] = {
  artifacts: [{ artifact_id: "anyharness/host", version: "1.0.0", sha256: "e".repeat(64) }],
};

test("validateReport accepts a consistent report", () => {
  validateReport(validReport());
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
  validateReport(passing);

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
    validateReport(report);
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
    const report = validReport();
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
    await writeReport(dir, validReport());
    await assert.rejects(writeReport(dir, validReport()), ReportWriteError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("distinct attempts write distinct non-overwriting paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "q1-evidence-"));
  try {
    const first = validReport();
    const second = validReport();
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
  validateReport(withNull);

  const withEvidence = validReport();
  withEvidence.candidate_build = {
    artifacts: [{ artifact_id: "anyharness/aarch64-apple-darwin", version: "0.3.27", sha256: "e".repeat(64) }],
  };
  validateReport(withEvidence);
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
  validateReport(strictWithEvidence);
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
