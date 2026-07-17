// Unit coverage for `validateManagedCloudFixtureSmokeEvidence` +
// `sanitizeCellEvidence` (MANAGED-CLOUD-FIXTURE-SMOKE-1). Exercised through the
// public `validateReportV4` / `sanitizeReportV4Evidence` entry points, mirroring
// the tier2 test scaffolding but self-contained here (append-only file).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeReportV4Evidence,
  validateReportV4,
  expectedVerdict,
  type ManagedCloudFixtureSmokeEvidenceV1,
  type TestRunReportV3,
  type TestRunReportV4,
} from "./schema.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";

const SCENARIO_ID = "MANAGED-CLOUD-FIXTURE-SMOKE-1";

function smokeEvidence(
  cellName: string,
  overrides: Partial<ManagedCloudFixtureSmokeEvidenceV1> = {},
): ManagedCloudFixtureSmokeEvidenceV1 {
  const isCleanupReplay = cellName === "cleanup-replay";
  return {
    kind: "managed_cloud_fixture_smoke",
    artifact_ids: ["e2b-template/smoke-run-1", "candidate-api/smoke-run-1.qualification.proliferate.com"],
    world: {
      source_sha: "a".repeat(40),
      server_digest: "c".repeat(64),
      e2b_template_id: "tmpl_123",
      e2b_template_build_id: "build_456",
      e2b_template_input_hash: "e".repeat(64),
    },
    cells: [
      {
        cell_id: `${SCENARIO_ID}/sandbox/cell=${cellName}`,
        external_ids: ["cus_abc", "evt_def"],
        observed_transition: "held→replayed→duplicate:byte_identical(abc123)",
        cleanup_entries: ["stripe_customer"],
      },
    ],
    provider_sweeps: isCleanupReplay
      ? [
          { provider: "aws", remaining_owned_resources: 0 },
          { provider: "stripe", remaining_owned_resources: 0 },
          { provider: "e2b", remaining_owned_resources: 0 },
          { provider: "process", remaining_owned_resources: 0 },
          { provider: "filesystem", remaining_owned_resources: 0 },
        ]
      : [],
    ...overrides,
  };
}

function reportForCell(
  cellName: string,
  evidence: ManagedCloudFixtureSmokeEvidenceV1 | null,
  status: FinalTestStatus = "green",
): TestRunReportV4 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((s) => [s, 0])) as Record<FinalTestStatus, number>;
  byStatus[status] = 1;
  const cellId = `${SCENARIO_ID}/sandbox/cell=${cellName}`;
  const v3: TestRunReportV3 = {
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
      started_at: "2026-07-16T00:00:00Z",
      finished_at: "2026-07-16T00:01:00Z",
    },
    inputs: { target_lane: "cloud", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: cellId,
        scenario_id: SCENARIO_ID,
        registry_flow_ref: "specs#smoke",
        runtime_lane: "sandbox",
        dimensions: { cell: cellName },
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: cellId,
        scenario_id: SCENARIO_ID,
        registry_flow_ref: "specs#smoke",
        runtime_lane: "sandbox",
        dimensions: { cell: cellName },
        status,
        started_at: "2026-07-16T00:00:01Z",
        finished_at: "2026-07-16T00:00:59Z",
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
      intended_exit_code: status === "green" ? 0 : 1,
    },
    verdict: { status: "non_qualifying", scope: "selected_cells", completeness: "partial", reasons: [] },
  };
  v3.verdict.reasons = expectedVerdict(v3).reasons;
  return { ...v3, schema_version: 4, results: v3.results.map((r) => ({ ...r, evidence })) };
}

test("validateReportV4 accepts a green callback-relay cell with complete evidence", () => {
  validateReportV4(reportForCell("callback-relay", smokeEvidence("callback-relay")));
});

test("validateReportV4 accepts a green cleanup-replay cell with all-zero provider sweeps", () => {
  validateReportV4(reportForCell("cleanup-replay", smokeEvidence("cleanup-replay")));
});

test("validateReportV4 rejects a green fixture-smoke cell with null evidence (green-requires-evidence gate)", () => {
  assert.throws(() => validateReportV4(reportForCell("callback-relay", null)), /requires complete evidence/);
});

test("validateReportV4 rejects an undeclared top-level field", () => {
  const dirty = { ...smokeEvidence("callback-relay"), extra: "nope" } as unknown as ManagedCloudFixtureSmokeEvidenceV1;
  assert.throws(() => validateReportV4(reportForCell("callback-relay", dirty)), /undeclared or missing field/);
});

test("validateReportV4 rejects an external_id that looks like a Stripe secret", () => {
  const dirty = smokeEvidence("callback-relay", {
    cells: [
      {
        cell_id: `${SCENARIO_ID}/sandbox/cell=callback-relay`,
        external_ids: ["sk_test_leaked"],
        observed_transition: "x",
        cleanup_entries: [],
      },
    ],
  });
  assert.throws(() => validateReportV4(reportForCell("callback-relay", dirty)), /Stripe secret material/);
});

test("validateReportV4 rejects a whsec_ external id", () => {
  const dirty = smokeEvidence("callback-relay", {
    cells: [
      {
        cell_id: `${SCENARIO_ID}/sandbox/cell=callback-relay`,
        external_ids: ["whsec_abc"],
        observed_transition: "x",
        cleanup_entries: [],
      },
    ],
  });
  assert.throws(() => validateReportV4(reportForCell("callback-relay", dirty)), /Stripe secret material/);
});

test("validateReportV4 rejects more than one cells entry", () => {
  const c = smokeEvidence("callback-relay").cells[0]!;
  const dirty = smokeEvidence("callback-relay", { cells: [c, c] });
  assert.throws(() => validateReportV4(reportForCell("callback-relay", dirty)), /exactly one entry/);
});

test("validateReportV4 rejects an unknown sweep provider", () => {
  const dirty = smokeEvidence("cleanup-replay", {
    provider_sweeps: [{ provider: "gcp" as never, remaining_owned_resources: 0 }],
  });
  assert.throws(() => validateReportV4(reportForCell("cleanup-replay", dirty)), /must be one of/);
});

test("validateReportV4 rejects a negative remaining_owned_resources", () => {
  const dirty = smokeEvidence("cleanup-replay", {
    provider_sweeps: [{ provider: "aws", remaining_owned_resources: -1 }],
  });
  assert.throws(() => validateReportV4(reportForCell("cleanup-replay", dirty)), /non-negative integer/);
});

test("validateReportV4 rejects a green cleanup-replay cell whose sweep still reports owned resources", () => {
  const dirty = smokeEvidence("cleanup-replay", {
    provider_sweeps: smokeEvidence("cleanup-replay").provider_sweeps.map((sweep) =>
      sweep.provider === "stripe" ? { ...sweep, remaining_owned_resources: 2 } : sweep,
    ),
  });
  assert.throws(() => validateReportV4(reportForCell("cleanup-replay", dirty)), /remaining owned resources/);
});

test("validateReportV4 rejects a green cleanup-replay cell missing one required provider sweep", () => {
  const dirty = smokeEvidence("cleanup-replay", {
    provider_sweeps: smokeEvidence("cleanup-replay").provider_sweeps.filter((sweep) => sweep.provider !== "e2b"),
  });
  assert.throws(() => validateReportV4(reportForCell("cleanup-replay", dirty)), /exactly one/);
});

test("validateReportV4 rejects a green cleanup-replay cell with a duplicate provider sweep", () => {
  const rows = smokeEvidence("cleanup-replay").provider_sweeps;
  const dirty = smokeEvidence("cleanup-replay", {
    provider_sweeps: [...rows, { provider: "aws", remaining_owned_resources: 0 }],
  });
  assert.throws(() => validateReportV4(reportForCell("cleanup-replay", dirty)), /exactly one/);
});

test("validateReportV4 rejects provider sweeps on a non-cleanup-replay cell", () => {
  const dirty = smokeEvidence("callback-relay", {
    provider_sweeps: [{ provider: "aws", remaining_owned_resources: 0 }],
  });
  assert.throws(() => validateReportV4(reportForCell("callback-relay", dirty)), /non-cleanup-replay/);
});

test("a non-green cleanup-replay cell may carry non-zero sweeps (records its own failure)", () => {
  const failing = smokeEvidence("cleanup-replay", {
    provider_sweeps: [{ provider: "stripe", remaining_owned_resources: 1 }],
  });
  validateReportV4(reportForCell("cleanup-replay", failing, "failed"));
});

test("the cell binding rejects a foreign evidence kind for a fixture-smoke cell", () => {
  // A structurally-valid tier2 object attached to a fixture-smoke cell must be
  // rejected by the (scenario_id, cell) binding.
  const foreign = {
    kind: "tier2_billing",
    manifest_id: "T2-BILL-2",
    server_version: "0.1.0",
    billing_mode: "enforce",
    asserted_policy: {},
    stripe: { test_clock_ids: [], object_ids: [] },
    ledger: {
      grants_delta: 0,
      seat_adjustments_delta: 0,
      usage_exports_delta: 0,
      llm_events_delta: 0,
      webhook_receipts_delta: 0,
      holds_delta: 0,
    },
  } as unknown as ManagedCloudFixtureSmokeEvidenceV1;
  assert.throws(() => validateReportV4(reportForCell("callback-relay", foreign)), /requires "managed_cloud_fixture_smoke"/);
});

// ── Sanitizer ────────────────────────────────────────────────────────────────

test("sanitizeReportV4Evidence redacts an embedded secret in a fixture-smoke field", () => {
  const secret = "sk_test_supersecretvalue";
  const evidence = smokeEvidence("callback-relay", {
    cells: [
      {
        cell_id: `${SCENARIO_ID}/sandbox/cell=callback-relay`,
        // A secret that leaked into observed_transition must be scrubbed.
        external_ids: ["cus_ok"],
        observed_transition: `leaked ${secret} here`,
        cleanup_entries: ["stripe_customer"],
      },
    ],
  });
  const report = reportForCell("callback-relay", evidence);
  const sanitized = sanitizeReportV4Evidence(report, [secret]);
  const cleaned = sanitized.results[0]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
  assert.ok(!cleaned.cells[0]!.observed_transition.includes(secret));
  assert.match(cleaned.cells[0]!.observed_transition, /REDACTED/);
});

test("a sanitized valid evidence object still passes validation (round-trip)", () => {
  const report = reportForCell("cleanup-replay", smokeEvidence("cleanup-replay"));
  const sanitized = sanitizeReportV4Evidence(report, []);
  validateReportV4(sanitized);
});
