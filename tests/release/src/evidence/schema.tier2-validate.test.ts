// Unit coverage for `validateTier2BillingEvidence` (PR 4, workstream D,
// BRIEF §2). Exercises the validator through the public `validateReportV4`
// entry point (the kind-scoped dispatch it lives behind), mirroring
// write.test.ts's report-scaffolding convention but self-contained here so
// this file stays independently ownable/reviewable.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateReportV4,
  expectedVerdict,
  type TestRunReportV3,
  type TestRunReportV4,
  type Tier2BillingEvidenceV1,
} from "./schema.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";

function tier2Evidence(overrides: Partial<Tier2BillingEvidenceV1> = {}): Tier2BillingEvidenceV1 {
  return {
    kind: "tier2_billing",
    manifest_id: "T2-BILL-2",
    server_version: "0.3.27",
    billing_mode: "enforce",
    asserted_policy: { free_grant_usd: 2, llm_per_seat_usd: 5, compute_per_seat_usd: 15 },
    stripe: { test_clock_ids: ["tc_1", "tc_2"], object_ids: ["cus_1", "sub_1"] },
    ledger: {
      grants_delta: 2,
      seat_adjustments_delta: 0,
      usage_exports_delta: 0,
      llm_events_delta: 0,
      webhook_receipts_delta: 0,
      holds_delta: 0,
    },
    ...overrides,
  };
}

function baseReportV4(): TestRunReportV3 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = 1;
  const report: TestRunReportV3 = {
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
        cell_id: "T2-BILL/local/case=T2-BILL-2",
        scenario_id: "T2-BILL",
        registry_flow_ref: "specs#T2-BILL",
        runtime_lane: "local",
        dimensions: { case: "T2-BILL-2" },
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: "T2-BILL/local/case=T2-BILL-2",
        scenario_id: "T2-BILL",
        registry_flow_ref: "specs#T2-BILL",
        runtime_lane: "local",
        dimensions: { case: "T2-BILL-2" },
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
  };
  report.verdict.reasons = expectedVerdict(report).reasons;
  return report;
}

function tier2ReportV4(evidence: Tier2BillingEvidenceV1 | null): TestRunReportV4 {
  const v3 = baseReportV4();
  return {
    ...v3,
    schema_version: 4,
    results: v3.results.map((result) => ({ ...result, evidence })),
  };
}

test("validateReportV4 accepts a green T2-BILL cell with complete tier2_billing evidence", () => {
  validateReportV4(tier2ReportV4(tier2Evidence()));
});

test("validateReportV4 rejects a green T2-BILL cell with null evidence (green-requires-evidence gate)", () => {
  assert.throws(() => validateReportV4(tier2ReportV4(null)), /requires complete evidence/);
});

test("validateReportV4 rejects an undeclared top-level field", () => {
  const dirty = { ...tier2Evidence(), extra: "nope" } as unknown as Tier2BillingEvidenceV1;
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects an undeclared asserted_policy field", () => {
  const dirty = tier2Evidence({ asserted_policy: { not_a_ruled_field: 1 } as any });
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /undeclared field/);
});

test("validateReportV4 rejects a negative or non-finite asserted_policy value", () => {
  assert.throws(
    () => validateReportV4(tier2ReportV4(tier2Evidence({ asserted_policy: { free_grant_usd: -1 } }))),
    /must be a finite number/,
  );
  assert.throws(
    () => validateReportV4(tier2ReportV4(tier2Evidence({ asserted_policy: { free_grant_usd: Number.NaN } }))),
    /must be a finite number/,
  );
});

test("validateReportV4 accepts an empty asserted_policy (a case that asserted no ruled value)", () => {
  validateReportV4(tier2ReportV4(tier2Evidence({ asserted_policy: {} })));
});

test("validateReportV4 rejects an invalid billing_mode", () => {
  const dirty = tier2Evidence({ billing_mode: "bogus" as unknown as Tier2BillingEvidenceV1["billing_mode"] });
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /billing_mode must be one of/);
});

test("validateReportV4 rejects an unsafe manifest_id", () => {
  const dirty = tier2Evidence({ manifest_id: "../etc/passwd" });
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /manifest_id is missing or unsafe/);
});

test("validateReportV4 rejects stripe id arrays that exceed the bounded cap", () => {
  const dirty = tier2Evidence({
    stripe: { test_clock_ids: Array.from({ length: 21 }, (_, i) => `tc_${i}`), object_ids: [] },
  });
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /exceeds the bounded cap/);
});

test("validateReportV4 rejects unsorted or duplicate stripe ids", () => {
  const unsorted = tier2Evidence({ stripe: { test_clock_ids: ["tc_2", "tc_1"], object_ids: [] } });
  assert.throws(() => validateReportV4(tier2ReportV4(unsorted)), /must be sorted ascending/);
  const dup = tier2Evidence({ stripe: { test_clock_ids: ["tc_1", "tc_1"], object_ids: [] } });
  assert.throws(() => validateReportV4(tier2ReportV4(dup)), /duplicate entry/);
});

test("validateReportV4 rejects a negative ledger delta", () => {
  const dirty = tier2Evidence({ ledger: { ...tier2Evidence().ledger, grants_delta: -1 } });
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /must be a non-negative integer/);
});

test("validateReportV4 rejects an incomplete ledger object (missing key)", () => {
  const { holds_delta: _drop, ...incompleteLedger } = tier2Evidence().ledger;
  const dirty = { ...tier2Evidence(), ledger: incompleteLedger } as unknown as Tier2BillingEvidenceV1;
  assert.throws(() => validateReportV4(tier2ReportV4(dirty)), /undeclared or missing field/);
});

test("validateReportV4 still validates local_workspace_turn cells unaffected by the tier2 dispatch branch", () => {
  const report = tier2ReportV4(null);
  const otherCellId = "OTHER-SCENARIO/local/case=T2-BILL-2";
  report.results[0].scenario_id = "OTHER-SCENARIO";
  report.results[0].cell_id = otherCellId;
  report.selected_cells[0].scenario_id = "OTHER-SCENARIO";
  report.selected_cells[0].cell_id = otherCellId;
  // A non-gated scenario id with null evidence on a green cell is fine.
  validateReportV4(report);
});
