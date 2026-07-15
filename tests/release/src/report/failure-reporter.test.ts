import assert from "node:assert/strict";
import { test } from "node:test";

import { toFailureReports } from "./failure-reporter.js";
import type { FinalCellResultV1 } from "../runner/result.js";

function failedResult(overrides: Partial<FinalCellResultV1> = {}): FinalCellResultV1 {
  return {
    cell_id: "T3-EXAMPLE/local",
    scenario_id: "T3-EXAMPLE",
    registry_flow_ref: "specs/developing/testing/scenarios.md#T3-EXAMPLE",
    runtime_lane: "local",
    dimensions: {},
    status: "failed",
    started_at: "2026-07-13T00:00:00Z",
    finished_at: "2026-07-13T00:00:01Z",
    duration_ms: 1000,
    reason: { code: "scenario_failure", message: "boom" },
    plan_steps: [],
    ...overrides,
  };
}

test("toFailureReports maps a normalized failed result to the issue payload", () => {
  const [report] = toFailureReports([failedResult()]);
  assert.equal(report.scenario_id, "T3-EXAMPLE/local");
  assert.equal(report.flow, "specs/developing/testing/scenarios.md#T3-EXAMPLE");
  assert.equal(report.lane, "local");
  assert.match(report.observed, /boom/);
  assert.equal(report.timestamp, "2026-07-13T00:00:01Z");
  assert.deepEqual(report.correlation_ids, []);
});

test("toFailureReports produces payloads only for failed results", () => {
  const results: FinalCellResultV1[] = [
    failedResult(),
    failedResult({ cell_id: "T3-B/local", scenario_id: "T3-B", status: "blocked" }),
    failedResult({ cell_id: "T3-C/local", scenario_id: "T3-C", status: "expected_fail" }),
    failedResult({ cell_id: "T3-D/local", scenario_id: "T3-D", status: "cancelled" }),
    failedResult({ cell_id: "T3-E/local", scenario_id: "T3-E", status: "not_run" }),
    failedResult({ cell_id: "T3-F/local", scenario_id: "T3-F", status: "missing" }),
    failedResult({ cell_id: "T3-G/local", scenario_id: "T3-G", status: "green" }),
  ];
  const reports = toFailureReports(results);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].scenario_id, "T3-EXAMPLE/local");
});

test("toFailureReports handles a failed result with no recorded reason", () => {
  const [report] = toFailureReports([failedResult({ reason: null })]);
  assert.match(report.observed, /no recorded reason/);
});
