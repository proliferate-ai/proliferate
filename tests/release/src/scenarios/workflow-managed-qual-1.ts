import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type {
  WorkflowManagedCell,
  WorkflowManagedCleanupBlock,
  WorkflowManagedPlacement,
  WorkflowManagedRunEvidenceV1,
} from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";

/**
 * WORKFLOW-MANAGED-QUAL-1 — the managed one-prompt Workflow qualification
 * release tail (frozen "Required evidence ladder" → Tier 3, "Real journey
 * 1/2/3", founder decision 1). THREE strict cells, one matrix scenario, lane
 * `sandbox` (the E2B/managed-cloud runtime lane; the `--lane` TargetLane is
 * `cloud`, the run-scoped candidate API — mirroring CLOUD-PROVISION-1), harness
 * `claude`:
 *
 *   1. WF-MANAGED-COMPLETION — managed completion + exact replay (repository
 *      AND scratch placement; frozen "Real journey 1");
 *   2. WF-MANAGED-CONTROL    — running cancellation + same-store process restart
 *      (frozen "Real journey 2");
 *   3. WF-MANAGED-CUSTODY    — background recovery + execution-store loss /
 *      `target_lost` (frozen "Real journey 3", destructive-drill founder
 *      decision 3).
 *
 * ── PROVISIONAL SPEC (0.5) / FAIL-CLOSED, NON-GREEN OFFLINE ─────────────────
 * This is a TEST/EVIDENCE HARNESS lane on a PROVISIONAL, not-frozen 0.5 spec.
 * The frozen contract's "External hosted prerequisite" is EXPLICITLY NOT owned
 * here: there is no live staging managed-Workflow background plane (RabbitMQ,
 * Valkey/RedBeat, Celery worker, Beat), `ECS_WORKER_SERVICE`/`ECS_BEAT_SERVICE`
 * are absent, and `WORKFLOW_MANAGED_RUNS_ENABLED` defaults false so managed
 * launch is server-gated OFF. This release tail also does NOT own deployment,
 * provisioning, or production promotion.
 *
 * Therefore the production driver FAILS CLOSED for every cell with a bounded,
 * secret-free reason (WFR-F01/-F02/-F03). This program has a documented history
 * of false-green findings, so a live managed journey we cannot prove offline is
 * recorded as an explicit non-green — never a fabricated green. The three cells
 * become green (emitting complete `workflow_managed_run` evidence) ONLY once the
 * external live plane + founder sign-off exist and a real driver is wired; that
 * green path is exercised OFFLINE by the fake driver in the unit tests so the
 * evidence shape + orchestration are proven now.
 *
 * Unit tests are OFFLINE: they inject a fake `WorkflowManagedQualDriver`, so no
 * real AWS/E2B/RabbitMQ/broker/anthropic/network is ever touched.
 */

export const WORKFLOW_MANAGED_QUAL_1_ID = "WORKFLOW-MANAGED-QUAL-1";
export const REPRESENTATIVE_HARNESS = "claude";

/** The env var attesting the live background plane exists (frozen prerequisite). */
export const MANAGED_PLANE_ENV = "RELEASE_E2E_WORKFLOW_MANAGED_PLANE";

/** The three canonical `cell` dimension values (frozen founder decision 1). */
export const WF_MANAGED_COMPLETION: WorkflowManagedCell = "WF-MANAGED-COMPLETION";
export const WF_MANAGED_CONTROL: WorkflowManagedCell = "WF-MANAGED-CONTROL";
export const WF_MANAGED_CUSTODY: WorkflowManagedCell = "WF-MANAGED-CUSTODY";

export const WORKFLOW_MANAGED_CELL_ORDER: readonly WorkflowManagedCell[] = [
  WF_MANAGED_COMPLETION,
  WF_MANAGED_CONTROL,
  WF_MANAGED_CUSTODY,
];

/**
 * The bounded, secret-free reason each cell fails closed with while the live
 * background plane / gate is absent (or provisioning is unproven). No credential,
 * path, raw URL, run/invocation id, or transcript — only the safe cell name and
 * the honest capability boundary the frozen spec itself names.
 */
export function managedPlaneUnavailableReason(cell: WorkflowManagedCell): string {
  return (
    `${cell} [WFR-F01]: the managed one-prompt Workflow qualification cannot run for real. This release tail is a ` +
    `test/evidence harness on a PROVISIONAL 0.5 spec; the frozen "External hosted prerequisite" (live staging ` +
    `RabbitMQ + Valkey/RedBeat + Celery worker + Beat, ECS_WORKER_SERVICE/ECS_BEAT_SERVICE + broker/store ids, ` +
    `API/worker/Beat deployed from one immutable digest with the relay-heartbeat + exact-ID execution proof, then ` +
    `WORKFLOW_MANAGED_RUNS_ENABLED=true in staging) is owned OUTSIDE this lane and is not present. No live managed ` +
    `background path exists to exercise, so this cell fails closed rather than emitting a false-green. This is the ` +
    `honest live-acceptance boundary, not a harness defect — it clears only after the external provisioning + ` +
    `founder sign-off, when the real driver replaces the fail-closed production path.`
  );
}

/** Reason when the plane env is set but this lane still declines to fabricate a live green. */
export function provisioningNotOwnedReason(cell: WorkflowManagedCell): string {
  return (
    `${cell} [WFR-F02]: ${MANAGED_PLANE_ENV} attests a live background plane, but this release-tail harness does ` +
    `NOT own deployment, provisioning, or the live managed journeys (frozen "This release tail does not own"). ` +
    `The real live driver + its exact-candidate execution proof are a separate operational evidence phase; until ` +
    `that driver is wired here, this cell records an explicit non-green rather than a green it cannot prove offline. ` +
    `Escalated as live-acceptance debt, not reversed inline.`
  );
}

export const workflowManagedQual1: ScenarioDefinition = {
  id: WORKFLOW_MANAGED_QUAL_1_ID,
  kind: "matrix",
  title:
    "qualify the managed one-prompt Workflow product against exact staging artifacts: completion+replay, " +
    "cancellation+restart, and background-recovery+execution-store-loss custody (fail-closed until the external " +
    "live background plane + founder sign-off exist)",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#workflow-managed-qual-1",
  lanes: ["sandbox"],
  // The gateway triple (shared with CLOUD-PROVISION-1) is what a real cheap
  // managed turn would flow through; it is REQUIRED so absence blocks the cell
  // (rather than a fail-closed red that hides a missing credential).
  requiredEnv: [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ],
  expandCells: (): ScenarioCellSpec[] =>
    WORKFLOW_MANAGED_CELL_ORDER.map((cell) => ({
      dimensions: { cell, harness: REPRESENTATIVE_HARNESS },
      // The live background plane attestation is READ but does NOT gate planning:
      // its absence must be a fail-closed cell red (WFR-F01), never a runner-
      // blocked cell that could be mistaken for "not attempted" (PR7-CONTROL-004).
      optionalEnv: [MANAGED_PLANE_ENV],
    })),
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => planForCell(cell),
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runWorkflowManagedQualCells(ctx, cells, defaultWorkflowManagedQualDriver),
};

function planForCell(cell: PlannedCellV1): ScenarioPlanStep[] {
  const prefix = `[${cell.cell_id}]`;
  const which = cell.dimensions.cell as WorkflowManagedCell;
  const common: ScenarioPlanStep[] = [
    { description: `${prefix} require the live staging managed-Workflow background plane + gate (${MANAGED_PLANE_ENV}); absent → fail closed [WFR-F01]` },
    { description: `${prefix} freeze the exact candidate SHA/image/artifact digests, E2B template, and evidence manifest` },
  ];
  const perCell: Record<WorkflowManagedCell, ScenarioPlanStep[]> = {
    "WF-MANAGED-COMPLETION": [
      { description: `${prefix} author one eligible saved Workflow (scalar arg + one bounded run-tagged-file prompt) through the product UI` },
      { description: `${prefix} launch managed; observe prepared→queued→delivering→accepted→running→completed without regression` },
      { description: `${prefix} verify deterministic branch/path/base OID + one Cloud/AnyHarness identity; validate the run-tagged file against its schema` },
      { description: `${prefix} repeat exact invocation/deliver/materialize/run around simulated controller response loss; assert exactly one of each durable effect` },
      { description: `${prefix} repeat for BOTH placements (repository-worktree + scratch, workspaceKind=scratch/repo=null)` },
    ],
    "WF-MANAGED-CONTROL": [
      { description: `${prefix} launch a bounded prompt that keeps the turn running; cancel from product run detail` },
      { description: `${prefix} assert desired cancellation projects before terminal; AnyHarness terminalizes only from correlated cancelled-turn evidence; no second turn` },
      { description: `${prefix} restart AnyHarness preserving its SQLite store; assert same executionStoreId + interrupted/runtime_restarted with zero replay; transcript inspectable` },
    ],
    "WF-MANAGED-CUSTODY": [
      { description: `${prefix} commit a Workflow outbox task; interrupt broker/worker at an approved boundary; restore; assert convergence through the exact task generation + no duplicate effects` },
      { description: `${prefix} (destructive, Qualification-env + disposable ONLY) replace the AnyHarness SQLite store; assert NEW executionStoreId` },
      { description: `${prefix} assert Cloud becomes target_lost + preserves last projection; no PUT/redelivery into the fresh store; product copy says outcome unknown` },
    ],
  };
  return [...common, ...(perCell[which] ?? [])];
}

/** A managed-Workflow cell result sans the cleanup block (cleanup folds in after teardown). */
export type WorkflowEvidenceNoCleanup = Omit<WorkflowManagedRunEvidenceV1, "cleanup">;

export interface WorkflowManagedCellResult {
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  /** Evidence sans cleanup; `undefined` on a failed/fail-closed cell. */
  evidence?: WorkflowEvidenceNoCleanup;
}

/**
 * Every privileged/stateful step, factored out so unit tests fake the world +
 * managed journeys entirely. The production implementation
 * (`defaultWorkflowManagedQualDriver`) fails CLOSED (WFR-F01/-F02): the live
 * background plane + real driver are the external operational-evidence phase
 * this lane does not own.
 */
export interface WorkflowManagedQualDriver {
  /** Whether the operator attested the live background plane (frozen prerequisite). */
  planeAttested(ctx: ScenarioRunContext): boolean;
  /**
   * Run one strict managed-Workflow cell for real and return its evidence (sans
   * cleanup). The production implementation fails closed here.
   */
  runCell(ctx: ScenarioRunContext, cell: WorkflowManagedCell): Promise<WorkflowManagedCellResult>;
  /** Tear down this run's disposable fixtures ONLY; returns the reconciled cleanup block. */
  cleanup(ctx: ScenarioRunContext): Promise<WorkflowManagedCleanupBlock>;
}

export const defaultWorkflowManagedQualDriver: WorkflowManagedQualDriver = {
  planeAttested(ctx) {
    return ctx.env.present(MANAGED_PLANE_ENV);
  },

  async runCell(ctx, cell) {
    // Fail closed. If the plane is not even attested, WFR-F01; if it IS attested,
    // this lane still declines to fabricate a live green it does not own (WFR-F02).
    // No live driver is wired in this release-tail harness by design.
    const attested = this.planeAttested(ctx);
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: attested ? provisioningNotOwnedReason(cell) : managedPlaneUnavailableReason(cell),
      },
    };
  },

  async cleanup() {
    // Nothing was provisioned (fail-closed before any world), so cleanup is a
    // no-op clean block: zero registered, zero failed, nothing to delete.
    return emptyCleanupBlock();
  },
};

/**
 * The real per-scenario orchestration, independent of the matrix plumbing so it
 * is directly unit-testable against a fake `WorkflowManagedQualDriver`:
 *   1. run each assigned strict cell for real (or fail closed);
 *   2. tear down disposable fixtures exactly once;
 *   3. for an evidence-bearing cell, stamp the cleanup block and downgrade a
 *      green cell to failed if teardown did not fully reconcile.
 */
export async function runWorkflowManagedQualCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: WorkflowManagedQualDriver,
): Promise<ScenarioCellOutcome[]> {
  const results = new Map<string, WorkflowManagedCellResult>();
  for (const cell of cells) {
    const which = cell.dimensions.cell as WorkflowManagedCell | undefined;
    if (!which || !WORKFLOW_MANAGED_CELL_ORDER.includes(which)) {
      results.set(cell.cell_id, {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `WORKFLOW-MANAGED-QUAL-1 declares only ${WORKFLOW_MANAGED_CELL_ORDER.join(", ")}; "${cell.cell_id}" was not expected.`,
        },
      });
      continue;
    }
    try {
      results.set(cell.cell_id, await driver.runCell(ctx, which));
    } catch (error) {
      results.set(cell.cell_id, {
        status: "failed",
        reason: { code: "scenario_failure", message: describe(error) },
      });
    }
  }

  // Tear down this run's disposable fixtures exactly once (best-effort).
  let cleanup: WorkflowManagedCleanupBlock | undefined;
  let cleanupError: unknown;
  try {
    cleanup = await driver.cleanup(ctx);
  } catch (error) {
    cleanupError = error;
  }

  return cells.map((cell) => {
    const result = results.get(cell.cell_id)!;
    if (!result.evidence) {
      // A failed / fail-closed cell carries no evidence; fixtures were still torn
      // down above.
      return { cellId: cell.cell_id, status: result.status, reason: result.reason } satisfies ScenarioCellOutcome;
    }
    if (!cleanup) {
      return failedOutcome(
        cell.cell_id,
        `Disposable-fixture cleanup threw before producing a summary: ${describe(cleanupError)}`,
      );
    }
    const evidence: WorkflowManagedRunEvidenceV1 = { ...result.evidence, cleanup };
    if (result.status === "green" && !cleanupIsClean(cleanup)) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `Disposable-fixture cleanup did not fully reconcile (failed=${cleanup.failed}).`,
        },
        evidence,
      } satisfies ScenarioCellOutcome;
    }
    return { cellId: cell.cell_id, status: result.status, reason: result.reason, evidence } satisfies ScenarioCellOutcome;
  });
}

/** A green cleanup: `failed === 0` and every deletion boolean true. */
export function cleanupIsClean(cleanup: WorkflowManagedCleanupBlock): boolean {
  return (
    cleanup.failed === 0 &&
    cleanup.invocation_fixtures_deleted &&
    cleanup.disposable_workspace_deleted &&
    cleanup.disposable_sandbox_deleted &&
    cleanup.virtual_key_deleted &&
    cleanup.litellm_subjects_deleted &&
    cleanup.local_paths_removed
  );
}

/** A clean, empty cleanup block (nothing provisioned → nothing to delete). */
export function emptyCleanupBlock(): WorkflowManagedCleanupBlock {
  return {
    ledger_id_hash: "0".repeat(64),
    registered: 0,
    reconciled: 0,
    failed: 0,
    invocation_fixtures_deleted: true,
    disposable_workspace_deleted: true,
    disposable_sandbox_deleted: true,
    virtual_key_deleted: true,
    litellm_subjects_deleted: true,
    local_paths_removed: true,
  };
}

function failedOutcome(cellId: string, message: string): ScenarioCellOutcome {
  return { cellId, status: "failed", reason: { code: "scenario_failure", message } };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `--dry-run`-safe placement a completion cell would use (repository first). */
export function placementForPlanIndex(index: number): WorkflowManagedPlacement {
  return index % 2 === 0 ? "repository" : "scratch";
}
