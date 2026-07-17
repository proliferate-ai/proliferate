import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MANAGED_PLANE_ENV,
  REPRESENTATIVE_HARNESS,
  WF_MANAGED_COMPLETION,
  WF_MANAGED_CONTROL,
  WF_MANAGED_CUSTODY,
  WORKFLOW_MANAGED_CELL_ORDER,
  WORKFLOW_MANAGED_QUAL_1_ID,
  cleanupIsClean,
  defaultWorkflowManagedQualDriver,
  emptyCleanupBlock,
  managedPlaneUnavailableReason,
  provisioningNotOwnedReason,
  runWorkflowManagedQualCells,
  workflowManagedQual1,
  type WorkflowEvidenceNoCleanup,
  type WorkflowManagedCellResult,
  type WorkflowManagedQualDriver,
} from "./workflow-managed-qual-1.js";
import { isMatrixScenario, type ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import { buildPlannedCells } from "../runner/plan.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus, type PlannedCellV1 } from "../runner/result.js";
import {
  expectedVerdict,
  validateReportV4,
  type CellEvidenceV1,
  type TestRunReportV3,
  type TestRunReportV4,
  type WorkflowManagedCell,
  type WorkflowManagedRunEvidenceV1,
} from "../evidence/schema.js";

// ── Fakes: entirely offline. No AWS/E2B/RabbitMQ/broker/network/anthropic. ──

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [],
  };
}

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  const defaults: Record<string, string> = {
    AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
    AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
    AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
    ...vars,
  };
  return {
    all: [],
    missing: [],
    present: (name) => defaults[name] !== undefined,
    get: (name) => defaults[name],
    require: (name) => {
      const value = defaults[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "cloud",
    runtimeLane: "sandbox",
    desktop: "web",
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "run-1",
      shard_id: "shard-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/run-1",
    ports: null,
    ...overrides,
  };
}

function cellIdFor(cell: WorkflowManagedCell): string {
  return `${WORKFLOW_MANAGED_QUAL_1_ID}/sandbox/cell=${cell},harness=claude`;
}

function plannedCell(cell: WorkflowManagedCell): PlannedCellV1 {
  return {
    cell_id: cellIdFor(cell),
    scenario_id: WORKFLOW_MANAGED_QUAL_1_ID,
    registry_flow_ref: workflowManagedQual1.registryFlowRef,
    runtime_lane: "sandbox",
    dimensions: { cell, harness: "claude" },
    required_env: [...workflowManagedQual1.requiredEnv],
    optional_env: [MANAGED_PLANE_ENV],
  };
}

function allPlannedCells(): PlannedCellV1[] {
  return WORKFLOW_MANAGED_CELL_ORDER.map(plannedCell);
}

// ── Green fake driver: the path a real live driver would take once the external ──
// ── background plane + founder sign-off exist. Exercised OFFLINE only. ──

function greenEvidenceFor(cell: WorkflowManagedCell): WorkflowEvidenceNoCleanup {
  const base = {
    kind: "workflow_managed_run" as const,
    cell,
    artifact_ids: ["server/linux-amd64", "worker/linux-amd64"],
    server_version: "1.2.3",
    worker_version: "1.2.3",
    beat_version: "1.2.3",
    anyharness_version: "4.5.6",
    harness: "claude" as const,
    model_id: "anthropic/claude-haiku",
    placement: (cell === WF_MANAGED_COMPLETION ? "repository" : "scratch") as "repository" | "scratch",
    invocation_id_hash: "1".repeat(64),
    managed_execution_id_hash: "2".repeat(64),
    workspace_id_hash: "3".repeat(64),
    session_id_hash: "4".repeat(64),
    prompt_id_hash: "5".repeat(64),
    turn_id_hash: "6".repeat(64),
    execution_store_id_hash: "7".repeat(64),
  };
  if (cell === WF_MANAGED_COMPLETION) {
    return {
      ...base,
      observed_terminal_state: "completed",
      completion: {
        base_oid: "abc123def456",
        artifact_validated: true,
        replay_single_effect: true,
        single_outbox_generation: true,
        single_materialization: true,
      },
      control: null,
      custody: null,
    };
  }
  if (cell === WF_MANAGED_CONTROL) {
    return {
      ...base,
      observed_terminal_state: "cancelled",
      completion: null,
      control: {
        desired_before_terminal: true,
        terminal_from_correlated_evidence: true,
        no_second_turn: true,
        same_store_after_restart: true,
        interrupted_zero_replay: true,
      },
      custody: null,
    };
  }
  return {
    ...base,
    observed_terminal_state: "target_lost",
    completion: null,
    control: null,
    custody: {
      converged_exact_generation: true,
      no_duplicate_effect: true,
      new_store_after_replacement: true,
      target_lost_preserved_projection: true,
      no_redelivery_into_fresh_store: true,
      product_copy_unknown: true,
      disposable_qualification_gated: true,
    },
  };
}

function cleanCleanupBlock(): WorkflowManagedRunEvidenceV1["cleanup"] {
  return {
    ledger_id_hash: "8".repeat(64),
    registered: 3,
    reconciled: 3,
    failed: 0,
    invocation_fixtures_deleted: true,
    disposable_workspace_deleted: true,
    disposable_sandbox_deleted: true,
    virtual_key_deleted: true,
    litellm_subjects_deleted: true,
    local_paths_removed: true,
  };
}

function greenDriver(cleanup = cleanCleanupBlock()): WorkflowManagedQualDriver {
  return {
    planeAttested: () => true,
    runCell: async (_ctx, cell): Promise<WorkflowManagedCellResult> => ({
      status: "green",
      evidence: greenEvidenceFor(cell),
    }),
    cleanup: async () => cleanup,
  };
}

// ── Tests ──

test("scenario is registered as a matrix with three cells on the sandbox lane", () => {
  assert.equal(workflowManagedQual1.id, WORKFLOW_MANAGED_QUAL_1_ID);
  assert.ok(isMatrixScenario(workflowManagedQual1));
  assert.deepEqual([...workflowManagedQual1.lanes], ["sandbox"]);
});

test("planning expands exactly the three strict cells with MANAGED_PLANE_ENV as optional (not required)", async () => {
  const cells = await buildPlannedCells([workflowManagedQual1], {
    desktop: "web",
    agents: ["claude"],
    targetLane: "cloud",
  });
  assert.equal(cells.length, 3);
  assert.deepEqual(
    cells.map((c) => c.dimensions.cell).sort(),
    [...WORKFLOW_MANAGED_CELL_ORDER].sort(),
  );
  for (const cell of cells) {
    assert.ok(!cell.required_env.includes(MANAGED_PLANE_ENV), "plane env must NOT gate planning");
    assert.ok((cell.optional_env ?? []).includes(MANAGED_PLANE_ENV), "plane env must be optional");
    assert.equal(cell.dimensions.harness, REPRESENTATIVE_HARNESS);
  }
});

test("--lane local plans zero managed-Workflow cells (sandbox-lane scenario is not dragged onto the local sweep)", async () => {
  // The scenario declares only the `sandbox` runtime lane, so a `--lane local`
  // sweep admits none of its cells. Selected alone, that empties the whole
  // selection (a SelectionError) — proving the scenario contributes nothing to
  // the ubuntu local sweep. Alongside a local scenario it would simply be absent.
  await assert.rejects(
    buildPlannedCells([workflowManagedQual1], { desktop: "web", agents: ["claude"], targetLane: "local" }),
    /zero cells/,
  );
});

test("production driver FAILS CLOSED for every cell when the live plane is not attested (WFR-F01)", async () => {
  const ctx = fakeCtx({ env: fakeEnv() }); // no MANAGED_PLANE_ENV
  const outcomes = await runWorkflowManagedQualCells(ctx, allPlannedCells(), defaultWorkflowManagedQualDriver);
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed", `${outcome.cellId} must fail closed, not green`);
    assert.equal(outcome.evidence, undefined, "a fail-closed cell carries NO evidence (no false-green)");
    assert.match(outcome.reason?.message ?? "", /WFR-F01/);
  }
});

test("production driver still fails closed even WHEN the plane is attested (provisioning not owned here, WFR-F02)", async () => {
  const ctx = fakeCtx({ env: fakeEnv({ [MANAGED_PLANE_ENV]: "attested" }) });
  const outcomes = await runWorkflowManagedQualCells(ctx, allPlannedCells(), defaultWorkflowManagedQualDriver);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.evidence, undefined);
    assert.match(outcome.reason?.message ?? "", /WFR-F02/);
  }
});

test("fail-closed reasons are bounded and secret-free (no raw urls, no run/invocation ids)", () => {
  for (const cell of WORKFLOW_MANAGED_CELL_ORDER) {
    for (const reason of [managedPlaneUnavailableReason(cell), provisioningNotOwnedReason(cell)]) {
      assert.ok(reason.length <= 4096);
      assert.ok(reason.includes(cell));
      assert.doesNotMatch(reason, /https?:\/\//, "no raw URL in a fail-closed reason");
      assert.doesNotMatch(reason, /sk-[a-z]/, "no secret-shaped token in a fail-closed reason");
    }
  }
});

test("default cleanup is a clean, empty block (nothing provisioned → nothing to delete)", async () => {
  const block = await defaultWorkflowManagedQualDriver.cleanup(fakeCtx());
  assert.ok(cleanupIsClean(block));
  assert.deepEqual(block, emptyCleanupBlock());
});

test("green fake driver produces complete evidence that passes validateReportV4 for every cell", async () => {
  const outcomes = await runWorkflowManagedQualCells(fakeCtx(), allPlannedCells(), greenDriver());
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green");
    assert.ok(outcome.evidence, "a green cell must carry evidence");
    // End-to-end schema validation through the real report validator.
    validateReportV4(reportFor(outcome.cellId, outcome.evidence!, "green"));
  }
});

test("a green cell whose disposable cleanup did not reconcile is downgraded to failed (still carries evidence)", async () => {
  const dirty = { ...cleanCleanupBlock(), ledger_id_hash: "9".repeat(64), failed: 1, disposable_sandbox_deleted: false };
  const outcomes = await runWorkflowManagedQualCells(fakeCtx(), allPlannedCells(), greenDriver(dirty));
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.evidence, "downgraded cell retains evidence recording the cleanup failure");
    assert.match(outcome.reason?.message ?? "", /did not fully reconcile/);
  }
});

test("an unexpected cell id is a failed outcome, never green", async () => {
  const bogus: PlannedCellV1 = {
    ...plannedCell(WF_MANAGED_COMPLETION),
    cell_id: `${WORKFLOW_MANAGED_QUAL_1_ID}/sandbox/cell=WF-BOGUS,harness=claude`,
    dimensions: { cell: "WF-BOGUS", harness: "claude" },
  };
  const outcomes = await runWorkflowManagedQualCells(fakeCtx(), [bogus], greenDriver());
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /was not expected/);
});

test("validateReportV4 REJECTS a completion proof attached to the control cell (per-cell binding)", () => {
  const completionEvidence = { ...greenEvidenceFor(WF_MANAGED_COMPLETION), cleanup: cleanCleanupBlock() };
  // Attach the completion evidence to the CONTROL cell id.
  assert.throws(
    () => validateReportV4(reportFor(cellIdFor(WF_MANAGED_CONTROL), completionEvidence, "green", WF_MANAGED_CONTROL)),
    /cell is "WF-MANAGED-COMPLETION" but the cell's dimensions name cell "WF-MANAGED-CONTROL"/,
  );
});

test("validateReportV4 REJECTS a green completion cell whose terminal state is not completed", () => {
  const bad = {
    ...greenEvidenceFor(WF_MANAGED_COMPLETION),
    observed_terminal_state: "target_lost" as const,
    cleanup: cleanCleanupBlock(),
  };
  assert.throws(
    () => validateReportV4(reportFor(cellIdFor(WF_MANAGED_COMPLETION), bad, "green")),
    /is not a green terminal for cell "WF-MANAGED-COMPLETION"/,
  );
});

test("validateReportV4 REJECTS a green cell with a null proof block", () => {
  const bad = { ...greenEvidenceFor(WF_MANAGED_CONTROL), control: null, cleanup: cleanCleanupBlock() };
  assert.throws(
    () => validateReportV4(reportFor(cellIdFor(WF_MANAGED_CONTROL), bad, "green")),
    /control must be non-null/,
  );
});

test("validateReportV4 REJECTS a green cell with an unclean cleanup block", () => {
  const bad = {
    ...greenEvidenceFor(WF_MANAGED_CUSTODY),
    cleanup: { ...cleanCleanupBlock(), failed: 2 },
  };
  assert.throws(
    () => validateReportV4(reportFor(cellIdFor(WF_MANAGED_CUSTODY), bad, "green")),
    /cleanup.failed must be 0 for a green result/,
  );
});

test("validateReportV4 REJECTS a raw-id-shaped hash (safe-hash discipline)", () => {
  const bad = {
    ...greenEvidenceFor(WF_MANAGED_COMPLETION),
    invocation_id_hash: "inv_1234567890", // not a 64-hex digest
    cleanup: cleanCleanupBlock(),
  };
  assert.throws(
    () => validateReportV4(reportFor(cellIdFor(WF_MANAGED_COMPLETION), bad, "green")),
    /invocation_id_hash must be a lowercase 64-hex digest/,
  );
});

// ── Report V4 builder (mirrors selfhost-isolation-1.test.ts) ──

function reportFor(
  cellId: string,
  evidence: CellEvidenceV1,
  status: FinalTestStatus,
  cellDimension?: WorkflowManagedCell,
): TestRunReportV4 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((s) => [s, 0])) as Record<FinalTestStatus, number>;
  byStatus[status] = 1;
  // Default the cell dimension to the evidence's own `cell` (so the canonical
  // cell id matches); the per-cell-binding test overrides it deliberately to
  // exercise a mismatch.
  const cell =
    cellDimension ??
    ((evidence as { cell?: WorkflowManagedCell }).cell ?? WF_MANAGED_COMPLETION);
  const dimensions = { cell, harness: "claude" };
  const base: TestRunReportV3 = {
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
      started_at: "2026-07-17T00:00:00Z",
      finished_at: "2026-07-17T00:01:00Z",
    },
    inputs: { target_lane: "cloud", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: cellId,
        scenario_id: WORKFLOW_MANAGED_QUAL_1_ID,
        registry_flow_ref: workflowManagedQual1.registryFlowRef,
        runtime_lane: "sandbox",
        dimensions,
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: cellId,
        scenario_id: WORKFLOW_MANAGED_QUAL_1_ID,
        registry_flow_ref: workflowManagedQual1.registryFlowRef,
        runtime_lane: "sandbox",
        dimensions,
        status,
        started_at: "2026-07-17T00:00:01Z",
        finished_at: "2026-07-17T00:00:59Z",
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
  base.verdict.reasons = expectedVerdict(base).reasons;
  return { ...base, schema_version: 4, results: base.results.map((r) => ({ ...r, evidence })) };
}
