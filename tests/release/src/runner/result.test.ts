import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_FINAL_STATUSES,
  countByStatus,
  deriveVerdict,
  ResultTracker,
  type FinalTestResultV1,
  type FinalTestStatus,
  type SelectedTestV1,
} from "./result.js";

function selected(id: string): SelectedTestV1 {
  return {
    test_id: `${id}/local`,
    scenario_id: id,
    registry_flow_ref: `specs#${id}`,
    runtime_lane: "local",
  };
}

function result(id: string, status: FinalTestStatus): FinalTestResultV1 {
  return {
    test_id: `${id}/local`,
    scenario_id: id,
    registry_flow_ref: `specs#${id}`,
    runtime_lane: "local",
    status,
    started_at: null,
    finished_at: "2026-07-13T00:00:00Z",
    duration_ms: null,
    reason: null,
    plan_steps: [],
  };
}

test("every selected test gets exactly one result; missing is synthesized with an integrity error", () => {
  const tracker = new ResultTracker([selected("A"), selected("B")]);
  tracker.finalize("A/local", { status: "green" });
  const results = tracker.finalizeRun("real");
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "green");
  assert.equal(results[1].status, "missing");
  assert.equal(results[1].reason?.code, "missing_result");
  assert.equal(tracker.integrityErrors.length, 1);
});

test("duplicate finalization preserves the first result and records an integrity error", () => {
  const tracker = new ResultTracker([selected("A")]);
  tracker.finalize("A/local", { status: "green" });
  tracker.finalize("A/local", { status: "failed" });
  const results = tracker.finalizeRun("real");
  assert.equal(results[0].status, "green");
  assert.equal(tracker.integrityErrors.length, 1);
  assert.equal(tracker.integrityErrors[0].code, "duplicate_result");
});

test("a result for an unselected test is a selection/result mismatch", () => {
  const tracker = new ResultTracker([selected("A")]);
  tracker.finalize("GHOST/local", { status: "green" });
  assert.equal(tracker.integrityErrors[0].code, "selection_result_mismatch");
});

test("not_run during real execution is an integrity error", () => {
  const tracker = new ResultTracker([selected("A")]);
  tracker.finalize("A/local", { status: "not_run", reason: { code: "dry_run", message: "planned" } });
  tracker.finalizeRun("real");
  assert.ok(tracker.integrityErrors.some((error) => error.code === "real_execution_not_run"));
});

test("not_run during dry_run is not an integrity error", () => {
  const tracker = new ResultTracker([selected("A")]);
  tracker.finalize("A/local", { status: "not_run", reason: { code: "dry_run", message: "planned" } });
  tracker.finalizeRun("dry_run");
  assert.equal(tracker.integrityErrors.length, 0);
});

test("countByStatus serializes all seven keys with exact counts", () => {
  const counts = countByStatus([result("A", "green"), result("B", "blocked"), result("C", "green")]);
  assert.deepEqual(Object.keys(counts).sort(), [...ALL_FINAL_STATUSES].sort());
  assert.equal(counts.green, 2);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.failed, 0);
});

// The full diagnostic/strict verdict matrix from the frozen spec.
const MATRIX: Array<{
  name: string;
  statuses: FinalTestStatus[];
  diagnostic: { exit: number; verdict: string };
  strict: { exit: number; verdict: string } | null;
}> = [
  {
    name: "every selected real test green",
    statuses: ["green", "green"],
    diagnostic: { exit: 0, verdict: "non_qualifying" },
    strict: { exit: 0, verdict: "selected_tests_passed" },
  },
  {
    name: "blocked only",
    statuses: ["green", "blocked"],
    diagnostic: { exit: 0, verdict: "non_qualifying" },
    strict: { exit: 1, verdict: "selected_tests_failed" },
  },
  {
    name: "expected-fail only",
    statuses: ["green", "expected_fail"],
    diagnostic: { exit: 0, verdict: "non_qualifying" },
    strict: { exit: 1, verdict: "selected_tests_failed" },
  },
  {
    name: "any failed",
    statuses: ["green", "failed", "blocked"],
    diagnostic: { exit: 1, verdict: "non_qualifying" },
    strict: { exit: 1, verdict: "selected_tests_failed" },
  },
  {
    name: "any cancelled",
    statuses: ["green", "cancelled"],
    diagnostic: { exit: 1, verdict: "non_qualifying" },
    strict: { exit: 1, verdict: "selected_tests_failed" },
  },
  {
    name: "any missing",
    statuses: ["green", "missing"],
    diagnostic: { exit: 1, verdict: "non_qualifying" },
    strict: { exit: 1, verdict: "selected_tests_failed" },
  },
  {
    name: "successful diagnostic dry-run (every test not_run)",
    statuses: ["not_run", "not_run"],
    diagnostic: { exit: 0, verdict: "non_qualifying" },
    strict: null, // strict dry-run is invalid at parse time; no verdict exists
  },
];

for (const row of MATRIX) {
  test(`matrix: ${row.name} (diagnostic)`, () => {
    const results = row.statuses.map((status, index) => result(`S${index}`, status));
    const verdict = deriveVerdict({ behavior: "diagnostic", results, integrityErrors: [], runnerErrors: [] });
    assert.equal(verdict.intendedExitCode, row.diagnostic.exit);
    assert.equal(verdict.status, row.diagnostic.verdict);
  });
  if (row.strict) {
    test(`matrix: ${row.name} (strict)`, () => {
      const results = row.statuses.map((status, index) => result(`S${index}`, status));
      const verdict = deriveVerdict({ behavior: "strict", results, integrityErrors: [], runnerErrors: [] });
      assert.equal(verdict.intendedExitCode, row.strict!.exit);
      assert.equal(verdict.status, row.strict!.verdict);
    });
  }
}

test("runner or integrity errors force exit 2 in both behaviors", () => {
  const results = [result("A", "green")];
  const integrity = [{ code: "duplicate_result" as const, message: "dup" }];
  const runner = [{ code: "issue_filing_failed" as const, message: "gh failed" }];

  const d1 = deriveVerdict({ behavior: "diagnostic", results, integrityErrors: integrity, runnerErrors: [] });
  assert.equal(d1.intendedExitCode, 2);
  assert.equal(d1.status, "non_qualifying");

  const s1 = deriveVerdict({ behavior: "strict", results, integrityErrors: [], runnerErrors: runner });
  assert.equal(s1.intendedExitCode, 2);
  assert.equal(s1.status, "selected_tests_failed");
});

test("strict all-green with any error cannot pass", () => {
  const verdict = deriveVerdict({
    behavior: "strict",
    results: [result("A", "green")],
    integrityErrors: [{ code: "summary_mismatch", message: "off by one" }],
    runnerErrors: [],
  });
  assert.equal(verdict.status, "selected_tests_failed");
  assert.equal(verdict.intendedExitCode, 2);
});
