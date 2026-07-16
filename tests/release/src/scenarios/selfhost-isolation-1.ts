import { createHash } from "node:crypto";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type { SelfHostCleanupEvidenceBlock, SelfHostSwitchIsolationEvidenceV1 } from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";
import type { ReadySelfHostWorld, SelfHostWorldPair } from "../worlds/selfhost/world.js";
import { constructSelfHostWorldPair } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";
// Reuse the install scenario's env/world-input resolver (imported, never
// modified) so the two self-host scenarios resolve AWS/SSH inputs identically.
import { resolveSelfHostWorldInputs, type SelfHostWorldConstructionInputs } from "./selfhost-install-1.js";

/**
 * SELFHOST-ISOLATION-1 (frozen tier-3 contract §`SH-SWITCH-ISOLATION`). ONE
 * matrix scenario, ONE journey-cell, lane `selfhost`, harness `claude`. The
 * canonical cell name `SH-SWITCH-ISOLATION` is carried as the `cell` dimension
 * value, giving a cell id like
 * `SELFHOST-ISOLATION-1/selfhost/cell=SH-SWITCH-ISOLATION,harness=claude`
 * (identical planned-cell mechanics to SELFHOST-INSTALL-1).
 *
 * Unlike the install scenario's single shared world, this cell provisions a
 * PAIR of independent self-host worlds (server A + server B — "Cross-server
 * isolation alone provisions two"). `runCells` builds the pair, runs the single
 * cell, closes BOTH worlds exactly once, and FOLDS the two cleanup summaries
 * into one evidence block (the shared cleanup categories cover kind-groups, so
 * two EC2 instances collapse into the same flag set — see
 * `SELFHOST_EVIDENCE_CATEGORIES`). A non-clean teardown of EITHER box makes an
 * otherwise-green cell non-green.
 *
 * ── HONEST MECHANISM (fail-closed) ─────────────────────────────────────────
 * The contract requires switching authenticated renderer product state from
 * server A to server B "through the shared host adapter", then asserting no A
 * credential/token/runtime-identity/workspace/session is visible on B.
 *
 * As of #1229 (`refactor(web): replace legacy Web with the shared
 * ProductClient`) the shared ProductClient owns the full connect-to-server switch
 * state machine (`useConnectServer`), and the DESKTOP (Tauri)
 * `ProductDeploymentHost` implements a working `switchDeployment`/
 * `resetDeployment` (a `set_app_config` config rewrite + full process relaunch).
 * The web auth session is now an HttpOnly refresh cookie plus an in-memory access
 * token — cookies are already origin-partitioned, so the old "localStorage keyed
 * by renderer origin" leak framing no longer applies. Hosted web is deliberately
 * single-deployment (`useWebProductHost` returns `{ apiBaseUrl }` with no switch).
 *
 * The remaining honest gap is narrow: the qualification harness serves the
 * candidate as a Tauri-less Chromium WEB renderer
 * (`worlds/selfhost/world.ts` `serveRenderer` + `launchChromium`), whose web
 * `ProductDeploymentHost` has no `switchDeployment`. So the A→B runtime switch —
 * which works on real Desktop — cannot be exercised or observed in THIS renderer.
 * The production driver STOPS at that boundary and fails the cell CLOSED with a
 * bounded, secret-free reason (SHR-F01). This is exactly the frozen contract's
 * expectation: "This case is fail-closed and currently expected to expose a
 * product bug; that does not make it optional." Whether hosted web should gain
 * multi-origin switching (reversing #1229's single-deployment web design) is a
 * founder scope call, escalated rather than reversed inline. If a drivable
 * web/renderer origin switch lands, the green path (create A state → switch →
 * assert isolation → emit {@link buildSwitchIsolationEvidence}) drops into
 * `runSwitchIsolation` and the orchestration below already folds cleanup + emits
 * the evidence unchanged (that path is exercised offline by the green fake driver
 * in the unit tests).
 *
 * Unit tests are OFFLINE: they inject a fake `SelfHostSwitchIsolationDriver` so
 * no real AWS/SSH/docker/network/anthropic is touched.
 */

export const SELFHOST_ISOLATION_1_ID = "SELFHOST-ISOLATION-1";
export const REPRESENTATIVE_HARNESS = "claude";

/** The single `cell` dimension value this scenario declares. */
export const SH_SWITCH_ISOLATION = "SH-SWITCH-ISOLATION";

/**
 * The bounded, secret-free reason the production switch step fails closed with
 * (frozen contract SHR-F01). No credential, path, or raw URL — only the two safe
 * API-origin hosts.
 *
 * ── Reason updated post-#1229 (2026-07-15) ─────────────────────────────────
 * #1229 (`refactor(web): replace legacy Web with the shared ProductClient`)
 * reshaped this surface: the shared `ProductClient` now owns the full connect-to-
 * server switch state machine (`useConnectServer`: entry → `/meta` → trust-
 * confirm → switch/relaunch), the DESKTOP (Tauri) `ProductDeploymentHost` exposes
 * a WORKING `switchDeployment`/`resetDeployment` (`setDesktopAppConfig` +
 * `relaunch`), and the web auth session is now an HttpOnly refresh cookie plus an
 * in-memory access token — NOT the localStorage-per-renderer-origin store the
 * pre-#1229 finding described. Hosted web is deliberately single-deployment by
 * that PR's design (`useWebProductHost` returns `{ apiBaseUrl }` with no switch).
 *
 * So the honest, current gap is NARROW: the switch motion the contract measures
 * exists on Desktop but the QUALIFICATION harness serves the candidate as a
 * Tauri-less Chromium web renderer (`worlds/selfhost/world.ts` `serveRenderer` +
 * `launchChromium`), whose `ProductDeploymentHost` has no `switchDeployment`
 * (hosted web is single-deployment by #1229's design). The cell therefore cannot
 * exercise or observe an A→B runtime switch in this renderer and fails CLOSED —
 * exactly the frozen contract's expectation ("fail-closed and currently expected
 * to expose a product bug; that does not make it optional"). Whether hosted web
 * SHOULD gain multi-origin switching is a founder scope call (it would reverse a
 * decision #1229 settled), escalated rather than reversed inline.
 */
export function switchUnavailableReason(serverAOrigin: string, serverBOrigin: string): string {
  return (
    `SH-SWITCH-ISOLATION [SHR-F01]: servers A (${serverAOrigin}) and B (${serverBOrigin}) are provisioned, ` +
    `but the isolation contract's runtime A→B origin switch cannot be exercised in this renderer. As of #1229 ` +
    `the shared ProductClient owns the connect-to-server flow and the DESKTOP (Tauri) ProductDeploymentHost ` +
    `implements switchDeployment/resetDeployment (set_app_config + relaunch), but the qualification harness serves ` +
    `the candidate as a Tauri-less Chromium web renderer, and hosted web is single-deployment by design ` +
    `(useWebProductHost exposes apiBaseUrl with no switchDeployment/resetDeployment). No web runtime origin ` +
    `switch exists to drive, so the switch motion cannot be performed or observed here. Failing closed: this is ` +
    `the honest capability boundary, not a harness defect. (The web session is an HttpOnly cookie + in-memory ` +
    `token post-#1229, so the earlier "localStorage keyed by renderer origin" framing no longer applies.)`
  );
}

export const selfhostIsolation1: ScenarioDefinition = {
  id: SELFHOST_ISOLATION_1_ID,
  kind: "matrix",
  title:
    "prove server-origin isolation: two real self-hosted instances, switch authenticated Desktop-renderer " +
    "product state from A to B through the shared host adapter, assert no A state leaks to B",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#sh-switch-isolation",
  lanes: ["selfhost"],
  // Two boxes on the same AWS account/zone reuse the install scenario's env
  // (region, hosted zone, instance type) plus the BYOK-A key used to create the
  // representative provider credential on server A.
  requiredEnv: [
    "RELEASE_E2E_SELFHOST_REGION",
    "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID",
    "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
    "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
  ],
  expandCells: (): ScenarioCellSpec[] => [
    { dimensions: { cell: SH_SWITCH_ISOLATION, harness: REPRESENTATIVE_HARNESS } },
  ],
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => planForCell(cell),
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runSelfHostSwitchIsolationCells(ctx, cells, defaultSelfHostSwitchIsolationDriver),
};

function planForCell(cell: PlannedCellV1): ScenarioPlanStep[] {
  const prefix = `[${cell.cell_id}]`;
  return [
    { description: `${prefix} provision TWO run-scoped self-host instances A and B (distinct EC2/SG/key-pair/DNS)` },
    { description: `${prefix} install + claim owner on A; create representative A state (BYOK credential, workspace/session)` },
    { description: `${prefix} authenticate isolated Desktop-renderer product state to A` },
    { description: `${prefix} switch that renderer product state to B through the shared product host adapter` },
    { description: `${prefix} assert no A token/refresh/pending-auth/credential/runtime-identity/workspace/session is visible on B` },
    { description: `${prefix} assert B starts anonymous + authenticates independently; reconnecting A restores only origin-scoped A state` },
    { description: `${prefix} tear down BOTH boxes; fold the two cleanup summaries into one evidence block` },
  ];
}

/** The kind-specific evidence WITHOUT the cleanup block (the pair closes once, after the cell). */
export type SwitchIsolationEvidenceNoCleanup = Omit<SelfHostSwitchIsolationEvidenceV1, "cleanup">;

export interface SelfHostSwitchCellResult {
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  /** Evidence sans the cleanup block; `undefined` on a failed/fail-closed cell. */
  evidence?: SwitchIsolationEvidenceNoCleanup;
}

/**
 * Every privileged/stateful step, factored out so unit tests fake the world
 * pair + switch entirely. Production wiring
 * (`defaultSelfHostSwitchIsolationDriver`) builds the real pair and fails the
 * switch closed at the product-gap boundary.
 */
export interface SelfHostSwitchIsolationDriver {
  buildWorldPair(inputs: SelfHostWorldConstructionInputs): Promise<SelfHostWorldPair>;
  /**
   * Create representative A state, switch to B, assert the isolation contract,
   * and return the switch-isolation evidence (sans cleanup). The production
   * implementation fails CLOSED here (SHR-F01): the web renderer has no runtime
   * origin switch to drive.
   */
  runSwitchIsolation(pair: SelfHostWorldPair): Promise<SelfHostSwitchCellResult>;
  closeWorld(world: ReadySelfHostWorld): Promise<SelfHostWorldCleanupEvidence>;
}

export const defaultSelfHostSwitchIsolationDriver: SelfHostSwitchIsolationDriver = {
  buildWorldPair: (inputs) =>
    constructSelfHostWorldPair({
      run: inputs.run,
      map: inputs.map,
      runDir: inputs.runDir,
      ports: inputs.ports,
      aws: inputs.aws,
      ssh: inputs.ssh,
    }),

  async runSwitchIsolation(pair) {
    // The contract's A→B runtime origin switch works on real Desktop (Tauri) as
    // of #1229 but cannot be exercised in the harness's Tauri-less Chromium web
    // renderer (hosted web is single-deployment by design — see the module doc).
    // Fail closed at the boundary with a bounded, secret-free reason. The two
    // boxes were really provisioned (so the origins below are real + distinct)
    // and are still torn down by the orchestration's closeWorld calls after this
    // returns.
    //
    // TODO(harness/product origin-switch): a green path needs a DRIVABLE renderer
    // origin switch — either run the candidate under a real Tauri runtime (so the
    // desktop switchDeployment + relaunch can be driven) or a founder decision to
    // give hosted web multi-origin switching. Then replace this fail-closed
    // return with: install + claim owner on A → store a BYOK provider credential +
    // create one workspace/session on A → authenticate the renderer to A → drive
    // the shared host adapter's switch to B → assert no A token/refresh/
    // pending-auth/credential/runtime-identity/workspace/session is visible on B,
    // B starts anonymous + authenticates independently, and reconnecting A
    // restores only origin-scoped A state → then
    // `return { status: "green", evidence: buildSwitchIsolationEvidence(pair) }`.
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: switchUnavailableReason(originOf(pair.a.api.baseUrl), originOf(pair.b.api.baseUrl)),
      },
    };
  },

  closeWorld: (world) => world.close(),
};

/**
 * The real per-scenario orchestration, independent of the matrix plumbing so it
 * is directly unit-testable against a fake `SelfHostSwitchIsolationDriver`:
 *   1. resolve world-construction inputs (typed failure → the cell fails clean);
 *   2. build the world PAIR (a build failure fails the cell without a close);
 *   3. run the single switch-isolation cell;
 *   4. close BOTH worlds exactly once and, for an evidence-bearing cell, fold the
 *      two cleanup summaries into one block — downgrading a green cell to failed
 *      if EITHER box did not fully reconcile.
 */
export async function runSelfHostSwitchIsolationCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: SelfHostSwitchIsolationDriver,
): Promise<ScenarioCellOutcome[]> {
  const switchCell = cells.find((cell) => cell.dimensions.cell === SH_SWITCH_ISOLATION);

  const inputs = resolveSelfHostWorldInputs(ctx);
  if (!inputs.ok) {
    return cells.map((cell) => failedOutcome(cell.cell_id, inputs.reason));
  }

  let pair: SelfHostWorldPair;
  try {
    pair = await driver.buildWorldPair(inputs.value);
  } catch (error) {
    return cells.map((cell) => failedOutcome(cell.cell_id, `world pair construction failed: ${describe(error)}`));
  }

  let result: SelfHostSwitchCellResult;
  try {
    result = await driver.runSwitchIsolation(pair);
  } catch (error) {
    result = { status: "failed", reason: { code: "scenario_failure", message: describe(error) } };
  }

  // Close BOTH worlds exactly once, best-effort, so neither box leaks even when
  // the cell failed. A close throw for either box means we cannot produce a
  // complete folded summary.
  let cleanupA: SelfHostWorldCleanupEvidence | undefined;
  let cleanupB: SelfHostWorldCleanupEvidence | undefined;
  let closeError: unknown;
  try {
    cleanupA = await driver.closeWorld(pair.a);
  } catch (error) {
    closeError = error;
  }
  try {
    cleanupB = await driver.closeWorld(pair.b);
  } catch (error) {
    closeError = closeError ?? error;
  }
  const folded = cleanupA && cleanupB ? foldSelfHostCleanup(cleanupA, cleanupB) : undefined;

  return cells.map((cell) => {
    if (!switchCell || cell.cell_id !== switchCell.cell_id) {
      return failedOutcome(
        cell.cell_id,
        `SELFHOST-ISOLATION-1 declares only the "${SH_SWITCH_ISOLATION}" cell; "${cell.cell_id}" was not expected.`,
      );
    }
    if (!result.evidence) {
      // A failed / fail-closed cell carries no evidence (mirrors the install
      // scenario); the two boxes were still torn down above.
      return { cellId: cell.cell_id, status: result.status, reason: result.reason } satisfies ScenarioCellOutcome;
    }
    if (!folded) {
      return failedOutcome(
        cell.cell_id,
        `World pair cleanup threw before producing a summary: ${describe(closeError)}`,
      );
    }
    const evidence = attachSwitchCleanup(result.evidence, folded);
    if (result.status === "green" && !cleanupIsClean(folded)) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `World pair cleanup did not fully reconcile (failed=${folded.failed}).`,
        },
        evidence,
      } satisfies ScenarioCellOutcome;
    }
    return { cellId: cell.cell_id, status: result.status, reason: result.reason, evidence } satisfies ScenarioCellOutcome;
  });
}

/**
 * Builds the complete switch-isolation evidence (sans cleanup) for a green
 * switch. `api_origin` is set to server A's origin (the validator requires
 * `api_origin === server_a_origin`, and `server_a_origin !== server_b_origin`).
 * Exercised offline by the green fake driver; ready for the production green
 * path once the product supports a runtime origin switch.
 */
export function buildSwitchIsolationEvidence(pair: SelfHostWorldPair): SwitchIsolationEvidenceNoCleanup {
  const a = pair.a;
  const serverAOrigin = originOf(a.api.baseUrl);
  const serverBOrigin = originOf(pair.b.api.baseUrl);
  return {
    kind: "selfhost_switch_isolation",
    artifact_ids: [
      a.artifacts.serverImage.artifact_id,
      a.artifacts.bundle.artifact_id,
      a.artifacts.anyharness.artifact_id,
      a.artifacts.desktopRenderer.artifact_id,
    ],
    server_version: a.artifacts.serverImage.version,
    anyharness_version: a.artifacts.anyharness.version,
    harness: "claude",
    api_origin: serverAOrigin,
    controller_runtime_origin: originOf(a.runtime.baseUrl),
    server_a_origin: serverAOrigin,
    server_b_origin: serverBOrigin,
    no_cross_origin_token: true,
    no_cross_origin_pending_auth: true,
    no_cross_origin_credential: true,
    no_cross_origin_runtime_identity: true,
    no_cross_origin_workspace_session: true,
    b_started_anonymous: true,
    b_authenticated_independently: true,
    a_state_restored_origin_scoped: true,
  };
}

/**
 * Folds the two per-box cleanup summaries into ONE evidence-shaped summary: the
 * shared cleanup categories are kind-groups, so two EC2 instances (two
 * `ec2_instance` registrations across two ledgers) collapse into the same flag
 * set. Counts sum; every deletion boolean is the AND of both boxes (a leak in
 * either box makes the combined flag false); the combined ledger hash is a
 * stable 64-hex digest of the two ledger hashes.
 */
export function foldSelfHostCleanup(
  a: SelfHostWorldCleanupEvidence,
  b: SelfHostWorldCleanupEvidence,
): SelfHostWorldCleanupEvidence {
  return {
    ledgerIdHash: createHash("sha256").update(`${a.ledgerIdHash}:${b.ledgerIdHash}`).digest("hex"),
    registered: a.registered + b.registered,
    reconciled: a.reconciled + b.reconciled,
    failed: a.failed + b.failed,
    ec2Terminated: a.ec2Terminated && b.ec2Terminated,
    securityGroupDeleted: a.securityGroupDeleted && b.securityGroupDeleted,
    keyPairDeleted: a.keyPairDeleted && b.keyPairDeleted,
    route53RecordDeleted: a.route53RecordDeleted && b.route53RecordDeleted,
    browserClosed: a.browserClosed && b.browserClosed,
    processesStopped: a.processesStopped && b.processesStopped,
    localPathsRemoved: a.localPathsRemoved && b.localPathsRemoved,
  };
}

/** Stamps the folded pair cleanup block into the switch-isolation evidence. */
export function attachSwitchCleanup(
  evidence: SwitchIsolationEvidenceNoCleanup,
  cleanup: SelfHostWorldCleanupEvidence,
): SelfHostSwitchIsolationEvidenceV1 {
  const cleanupBlock: SelfHostCleanupEvidenceBlock = {
    ledger_id_hash: cleanup.ledgerIdHash,
    registered: cleanup.registered,
    reconciled: cleanup.reconciled,
    failed: cleanup.failed,
    ec2_terminated: cleanup.ec2Terminated,
    security_group_deleted: cleanup.securityGroupDeleted,
    key_pair_deleted: cleanup.keyPairDeleted,
    route53_record_deleted: cleanup.route53RecordDeleted,
    browser_closed: cleanup.browserClosed,
    processes_stopped: cleanup.processesStopped,
    local_paths_removed: cleanup.localPathsRemoved,
  };
  return { ...evidence, cleanup: cleanupBlock };
}

/** A green pair cleanup: `failed === 0` and every deletion boolean true (mirrors the install scenario). */
export function cleanupIsClean(cleanup: SelfHostWorldCleanupEvidence): boolean {
  return (
    cleanup.failed === 0 &&
    cleanup.ec2Terminated &&
    cleanup.securityGroupDeleted &&
    cleanup.keyPairDeleted &&
    cleanup.route53RecordDeleted &&
    cleanup.browserClosed &&
    cleanup.processesStopped &&
    cleanup.localPathsRemoved
  );
}

function failedOutcome(cellId: string, message: string): ScenarioCellOutcome {
  return { cellId, status: "failed", reason: { code: "scenario_failure", message } };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The safe host (never the raw URL/credentials) evidence records for an origin. */
function originOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? url;
  }
}
