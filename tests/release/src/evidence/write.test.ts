import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  boundMessage,
  redactSecrets,
  ReportValidationError,
  validateReport,
  type TestRunReportV1,
} from "./schema.js";
import { reportPath, ReportWriteError, writeReport } from "./write.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";

function validReport(overrides: Partial<TestRunReportV1> = {}): TestRunReportV1 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = 1;
  return {
    schema_version: 1,
    kind: "proliferate.test-run",
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
    selected_tests: [
      { test_id: "A/local", scenario_id: "A", registry_flow_ref: "specs#A", runtime_lane: "local" },
    ],
    results: [
      {
        test_id: "A/local",
        scenario_id: "A",
        registry_flow_ref: "specs#A",
        runtime_lane: "local",
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
    verdict: { status: "non_qualifying", scope: "selected_tests", completeness: "partial", reasons: [] },
    ...overrides,
  };
}

test("validateReport accepts a consistent report", () => {
  validateReport(validReport());
});

test("validateReport rejects selected/result set mismatch and duplicates", () => {
  const extraSelected = validReport();
  extraSelected.selected_tests.push({
    test_id: "B/local",
    scenario_id: "B",
    registry_flow_ref: "specs#B",
    runtime_lane: "local",
  });
  extraSelected.summary.selected = 2;
  assert.throws(() => validateReport(extraSelected), ReportValidationError);

  const duplicated = validReport();
  duplicated.selected_tests.push({ ...duplicated.selected_tests[0] });
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
  report.verdict.status = "selected_tests_passed";
  assert.throws(() => validateReport(report), ReportValidationError);
});

test("validateReport enforces the strict verdict against results and errors", () => {
  const passing = validReport();
  passing.run.behavior = "strict";
  passing.verdict.status = "selected_tests_passed";
  validateReport(passing);

  const mislabeled = validReport();
  mislabeled.run.behavior = "strict";
  mislabeled.verdict.status = "selected_tests_failed";
  assert.throws(() => validateReport(mislabeled), ReportValidationError);

  const errorButPassed = validReport();
  errorButPassed.run.behavior = "strict";
  errorButPassed.verdict.status = "selected_tests_passed";
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
  strict.results[0].status = "failed";
  strict.summary.by_status.green = 0;
  strict.summary.by_status.failed = 1;
  strict.verdict.status = "selected_tests_passed";
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
const MATRIX_ROWS: Array<{ statuses: FinalTestStatus[]; behavior: "diagnostic" | "strict"; exit: 0 | 1 | 2; verdict: TestRunReportV1["verdict"]["status"]; execution?: "real" | "dry_run" }> = [
  { statuses: ["green"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["green"], behavior: "strict", exit: 0, verdict: "selected_tests_passed" },
  { statuses: ["blocked"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["blocked"], behavior: "strict", exit: 1, verdict: "selected_tests_failed" },
  { statuses: ["expected_fail"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying" },
  { statuses: ["expected_fail"], behavior: "strict", exit: 1, verdict: "selected_tests_failed" },
  { statuses: ["green", "failed"], behavior: "diagnostic", exit: 1, verdict: "non_qualifying" },
  { statuses: ["green", "failed"], behavior: "strict", exit: 1, verdict: "selected_tests_failed" },
  { statuses: ["cancelled"], behavior: "strict", exit: 1, verdict: "selected_tests_failed" },
  { statuses: ["missing"], behavior: "diagnostic", exit: 1, verdict: "non_qualifying" },
  { statuses: ["not_run"], behavior: "diagnostic", exit: 0, verdict: "non_qualifying", execution: "dry_run" },
];

for (const [index, row] of MATRIX_ROWS.entries()) {
  test(`validateReport accepts honest matrix row ${index}: ${row.behavior} ${row.statuses.join(",")}`, () => {
    const report = validReport();
    report.run.behavior = row.behavior;
    report.run.execution = row.execution ?? "real";
    report.selected_tests = row.statuses.map((_, i) => ({
      test_id: `S${i}/local`,
      scenario_id: `S${i}`,
      registry_flow_ref: `specs#S${i}`,
      runtime_lane: "local" as const,
    }));
    report.results = row.statuses.map((status, i) => ({
      ...report.results[0],
      test_id: `S${i}/local`,
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
    report.summary.intended_exit_code = row.exit;
    report.verdict.status = row.verdict;
    validateReport(report);
  });
}

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
