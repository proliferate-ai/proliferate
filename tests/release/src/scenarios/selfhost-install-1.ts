import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { BrowserContext, Page } from "playwright";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type {
  CellEvidenceV1,
  SelfHostBaseTurnEvidenceV1,
  SelfHostDesktopOwnerEvidenceV1,
  SelfHostInstallClaimEvidenceV1,
  SelfHostInviteeEvidenceV1,
} from "../evidence/schema.js";
import { SELFHOST_INSTALL_1_SCENARIO_ID } from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import type { LocalWorldPorts } from "../worlds/local-workspace/ports.js";
import type { SelfHostAwsInputs, SelfHostSshInputs, ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import { constructSelfHostWorld } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";
import { runShippedInstaller, waitForHealth } from "../worlds/selfhost/install.js";
import {
  claimSelfHostOwner,
  assertSecondClaimRejected,
  inviteAndRegisterMember,
  type SelfHostOwnerActor,
} from "../fixtures/selfhost-actor.js";
import {
  DEFAULT_BYOK_ENV_VAR,
  preflightByokKey,
  storeAndSelectByokKey,
  waitForDesktopByokSync,
} from "../fixtures/byok.js";
import {
  assertOnlyMetaFetchedBeforeTrust,
  assertRejectsInvalidUrl,
  assertRejectsNonProliferateHost,
  connectServerTrustFlow,
} from "../fixtures/connect-server.js";
import { AUTHENTICATED_READINESS_SELECTOR, BROWSER_AUTH_SESSION_KEY, type ProductPage } from "../fixtures/product-page.js";

/**
 * SELFHOST-INSTALL-1 (frozen spec "The four cells"). ONE matrix scenario, ONE
 * shared self-host world (one EC2 install), four journey-cells each returning a
 * single honest `ScenarioCellOutcome`. Lane `selfhost`, harness `claude`. The
 * canonical cell names `SH-INSTALL-CLAIM`/`SH-DESKTOP-OWNER`/`SH-BASE-TURN`/
 * `SH-INVITEE` are carried as the `cell` dimension value, giving cell ids like
 * `SELFHOST-INSTALL-1/selfhost/cell=SH-INSTALL-CLAIM,harness=claude`.
 *
 * `runCells` builds ONE world, runs the four cells IN ORDER (install/claim is a
 * hard prerequisite for the other three), then closes the world exactly once and
 * stamps the shared cleanup block into every cell's evidence — a non-clean
 * teardown makes every otherwise-green cell non-green (frozen spec: any
 * run-scoped AWS resource left after teardown → aggregate non-green). If
 * `SH-INSTALL-CLAIM` fails, the dependent cells fail cleanly with a bounded
 * "install prerequisite failed" reason rather than throwing out of `runCells`.
 *
 * Unit tests are OFFLINE: they inject a fake `SelfHostInstallDriver` so no real
 * AWS/SSH/docker/network/anthropic is touched.
 */

export const SELFHOST_INSTALL_1_ID = SELFHOST_INSTALL_1_SCENARIO_ID;
export const REPRESENTATIVE_HARNESS = "claude";

/** The `cell` dimension values, in run order. */
export const SH_INSTALL_CLAIM = "SH-INSTALL-CLAIM";
export const SH_DESKTOP_OWNER = "SH-DESKTOP-OWNER";
export const SH_BASE_TURN = "SH-BASE-TURN";
export const SH_INVITEE = "SH-INVITEE";
export const SELFHOST_CELL_ORDER = [SH_INSTALL_CLAIM, SH_DESKTOP_OWNER, SH_BASE_TURN, SH_INVITEE] as const;
export type SelfHostCellName = (typeof SELFHOST_CELL_ORDER)[number];

/** Bounded prompt for the SH-BASE-TURN cell's one turn. */
export const SELFHOST_TURN_PROMPT = "Reply with exactly the word: pong";
const TURN_TIMEOUT_MS = 300_000;
/** Bounded wait for the stack to serve again after a `docker compose restart`. */
const RESTART_HEALTH_TIMEOUT_MS = 180_000;
/** A real, healthy, reachable host that is definitely not a Proliferate control plane. */
const NON_PROLIFERATE_PROBE_URL = "https://example.com";

/**
 * Env the self-host lane needs. AWS/SSH provisioning inputs + the BYOK key are
 * resolved per-lane; a missing one is reported blocked (env-resolution), except
 * a strict run fails closed. (The exact names are appended to the env manifest
 * by this workstream — see BRIEF §"CLI + env manifest".)
 */
export const SELFHOST_REQUIRED_ENV = [
  "RELEASE_E2E_SELFHOST_REGION",
  "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID",
  "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
  "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
] as const;

export const selfhostInstall1: ScenarioDefinition = {
  id: SELFHOST_INSTALL_1_ID,
  kind: "matrix",
  title:
    "prove one real self-hosted installation: shipped installer on candidate bytes → claim → " +
    "Connect-Server trust → BYOK turn → invitee",
  registryFlowRef: "specs/developing/testing/flows.md#selfhost-install",
  lanes: ["selfhost"],
  requiredEnv: SELFHOST_REQUIRED_ENV,
  expandCells: (): ScenarioCellSpec[] =>
    SELFHOST_CELL_ORDER.map((cell) => ({ dimensions: { cell, harness: REPRESENTATIVE_HARNESS } })),
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => planForCell(cell),
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runSelfHostInstallCells(ctx, cells, defaultSelfHostInstallDriver),
};

function planForCell(cell: PlannedCellV1): ScenarioPlanStep[] {
  const name = cell.dimensions.cell ?? "";
  const prefix = `[${cell.cell_id}]`;
  switch (name) {
    case SH_INSTALL_CLAIM:
      return [
        { description: `${prefix} scp bundle + server-image archive; docker load the candidate image` },
        { description: `${prefix} run the SHIPPED install.sh against the candidate bundle (.env.static pinned to the loaded tag)` },
        { description: `${prefix} assert TLS, /health, /meta, advertised candidate versions, base capability truth` },
        { description: `${prefix} assert running image digest == candidate receipt` },
        { description: `${prefix} read the one-time setup token via SSH/SSM; first-owner claim succeeds` },
        { description: `${prefix} second claim permanently rejected (/setup closed/404)` },
        { description: `${prefix} restart the stack; assert DB/auth/config/version persistence` },
      ];
    case SH_DESKTOP_OWNER:
      return [
        { description: `${prefix} isolated Desktop-renderer page: reject invalid URL + non-Proliferate host` },
        { description: `${prefix} assert only public /meta is fetched before trust; point renderer at the instance` },
        { description: `${prefix} owner password login; assert exactly one org + candidate capabilities` },
      ];
    case SH_BASE_TURN:
      return [
        { description: `${prefix} BYOK preflight (fail closed if the provider rejects the key)` },
        { description: `${prefix} owner stores a run-scoped BYOK key; select it (surface=local, sourceKind=api_key)` },
        { description: `${prefix} Desktop pushes state into the controller-local candidate AnyHarness` },
        { description: `${prefix} create a local workspace + run one bounded cheapest-eligible Claude turn (no LiteLLM/E2B)` },
        { description: `${prefix} reopen; server/renderer/AnyHarness/workspace/session/transcript stay commandable` },
      ];
    case SH_INVITEE:
      return [
        { description: `${prefix} owner invites a member; capture the invitation response` },
        { description: `${prefix} register + login from a SECOND isolated product page` },
        { description: `${prefix} assert the intended role + one authenticated member action` },
      ];
    default:
      return [{ description: `${prefix} unknown self-host cell "${name}"` }];
  }
}

/** The world-construction inputs threaded off the scenario context. */
export interface SelfHostWorldConstructionInputs {
  map: CandidateBuildMapV1;
  run: RunIdentityV1;
  runDir: string;
  ports: LocalWorldPorts;
  aws: SelfHostAwsInputs;
  ssh: SelfHostSshInputs;
}

/**
 * Each cell body returns its kind-specific evidence WITHOUT the cleanup block
 * (the shared world closes once, after all four cells); the orchestrator stamps
 * the cleanup block in.
 */
export type SelfHostInstallClaimEvidenceNoCleanup = Omit<SelfHostInstallClaimEvidenceV1, "cleanup">;
export type SelfHostDesktopOwnerEvidenceNoCleanup = Omit<SelfHostDesktopOwnerEvidenceV1, "cleanup">;
export type SelfHostBaseTurnEvidenceNoCleanup = Omit<SelfHostBaseTurnEvidenceV1, "cleanup">;
export type SelfHostInviteeEvidenceNoCleanup = Omit<SelfHostInviteeEvidenceV1, "cleanup">;

export interface SelfHostCellResult {
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  /** Kind-specific evidence sans the cleanup block; `undefined` on early failure. */
  evidence?: CellEvidenceNoCleanup;
}

export type CellEvidenceNoCleanup =
  | SelfHostInstallClaimEvidenceNoCleanup
  | SelfHostDesktopOwnerEvidenceNoCleanup
  | SelfHostBaseTurnEvidenceNoCleanup
  | SelfHostInviteeEvidenceNoCleanup;

/**
 * Every privileged/stateful step, factored out so unit tests fake the
 * world/fixtures/browser/BYOK entirely. Production wiring
 * (`defaultSelfHostInstallDriver`) calls the real world/fixture/install/BYOK
 * functions the other workstreams own.
 */
export interface SelfHostInstallDriver {
  buildWorld(inputs: SelfHostWorldConstructionInputs): Promise<ReadySelfHostWorld>;
  /** Runs the installer + claim + second-claim-rejection + restart persistence. */
  runInstallClaim(world: ReadySelfHostWorld): Promise<SelfHostCellResult>;
  /** Connect-Server trust flow + owner login through an isolated renderer page. */
  runDesktopOwner(world: ReadySelfHostWorld): Promise<SelfHostCellResult>;
  /** BYOK preflight + store/select + Desktop sync + one bounded turn (no LiteLLM/E2B). */
  runBaseTurn(world: ReadySelfHostWorld): Promise<SelfHostCellResult>;
  /** Invite + register + login from a second isolated page + one member action. */
  runInvitee(world: ReadySelfHostWorld): Promise<SelfHostCellResult>;
  closeWorld(world: ReadySelfHostWorld): Promise<SelfHostWorldCleanupEvidence>;
}

/**
 * Per-world state the production driver threads between cells that share one
 * world (the owner claimed in SH-INSTALL-CLAIM is reused by SH-DESKTOP-OWNER/
 * SH-BASE-TURN/SH-INVITEE). Keyed by the world object itself (not a module-level
 * singleton) so it never leaks across worlds within one process.
 */
const driverStateByWorld = new WeakMap<ReadySelfHostWorld, { owner?: SelfHostOwnerActor }>();

function driverState(world: ReadySelfHostWorld): { owner?: SelfHostOwnerActor } {
  let state = driverStateByWorld.get(world);
  if (!state) {
    state = {};
    driverStateByWorld.set(world, state);
  }
  return state;
}

export const defaultSelfHostInstallDriver: SelfHostInstallDriver = {
  buildWorld: (inputs) =>
    constructSelfHostWorld({
      run: inputs.run,
      map: inputs.map,
      runDir: inputs.runDir,
      ports: inputs.ports,
      aws: inputs.aws,
      ssh: inputs.ssh,
    }),

  async runInstallClaim(world) {
    const { repo: candidateImageRepo, tag: candidateImageTag } = splitCandidateImageRef(world.artifacts.serverImage);
    const receipt = await runShippedInstaller({
      box: world.control.box,
      ssh: world.control.ssh,
      serverImageArchive: world.artifacts.serverImage,
      bundle: world.artifacts.bundle,
      bundleSha256SumsPath: bundleSha256SumsPath(world.artifacts.bundle.path),
      siteAddress: originOf(world.api.baseUrl),
      candidateImageRepo,
      candidateImageTag,
      corsAllowOrigins: browserOriginsForBox(world),
    });

    const setupToken = await world.control.readSetupToken();
    const owner = await claimSelfHostOwner(world);
    driverState(world).owner = owner;
    await assertSecondClaimRejected(world);
    await world.control.restartStack();
    // `docker compose restart` returns before the api container is serving again;
    // wait for the public HTTPS stack to report healthy so the persistence check
    // does not race a still-booting api (a 502 through Caddy) before asserting.
    await waitForHealth(world.api.baseUrl, { timeoutMs: RESTART_HEALTH_TIMEOUT_MS });
    // Persistence: the owner's session must still resolve exactly one org
    // after the restart — the on-box DB/auth/config survived the stack cycle.
    const orgsAfterRestart = await owner.api.get<{ organizations: Array<{ id: string }> }>("/v1/organizations");
    if (orgsAfterRestart.organizations.length !== 1) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `SH-INSTALL-CLAIM: owner org membership did not persist across restart (saw ${orgsAfterRestart.organizations.length} orgs).`,
        },
      };
    }

    const evidence: SelfHostInstallClaimEvidenceNoCleanup = {
      kind: "selfhost_install_claim",
      artifact_ids: artifactIds(world),
      server_version: receipt.serverVersion,
      anyharness_version: world.artifacts.anyharness.version,
      harness: "claude",
      api_origin: originOf(world.api.baseUrl),
      controller_runtime_origin: originOf(world.runtime.baseUrl),
      running_image_digest: receipt.runningImageDigest,
      bundle_sha256: receipt.bundleSha256,
      setup_token_hash: sha256Hex(setupToken),
      owner_user_id_hash: sha256Hex(owner.userId),
      org_id_hash: sha256Hex(owner.organizationId),
      tls_verified: true,
      second_claim_rejected: true,
      restart_persisted: true,
    };
    return { status: "green", evidence };
  },

  async runDesktopOwner(world) {
    const owner = driverState(world).owner;
    if (!owner) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: "SH-DESKTOP-OWNER requires SH-INSTALL-CLAIM's owner; none was captured on this world.",
        },
      };
    }
    const page = await openIsolatedPage(world);
    try {
      // A genuinely unparseable address: a bare token like "not-a-valid-url"
      // normalizes to a valid host (https://not-a-valid-url) exactly as the
      // product's normalizeServerUrl intends, so it is NOT rejected. "http://"
      // has a scheme but no host and fails URL parsing — a real invalid entry.
      await assertRejectsInvalidUrl(page, "http://");
      await assertRejectsNonProliferateHost(page, NON_PROLIFERATE_PROBE_URL);
      await assertOnlyMetaFetchedBeforeTrust(page, world.api.baseUrl);
      const trust = await connectServerTrustFlow(page, world.api.baseUrl);
      if (!trust.trusted) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: "SH-DESKTOP-OWNER: Connect-Server did not trust the run's own instance.",
          },
        };
      }
      await installSessionAndReload(page, owner.session);
      const orgs = await owner.api.get<{ organizations: Array<{ id: string }> }>("/v1/organizations");
      if (orgs.organizations.length !== 1) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-DESKTOP-OWNER: expected exactly one org, saw ${orgs.organizations.length}.`,
          },
        };
      }

      const evidence: SelfHostDesktopOwnerEvidenceNoCleanup = {
        kind: "selfhost_desktop_owner",
        artifact_ids: artifactIds(world),
        server_version: world.artifacts.serverImage.version,
        anyharness_version: world.artifacts.anyharness.version,
        harness: "claude",
        api_origin: originOf(world.api.baseUrl),
        controller_runtime_origin: originOf(world.runtime.baseUrl),
        owner_user_id_hash: sha256Hex(owner.userId),
        org_id_hash: sha256Hex(owner.organizationId),
        connect_rejected_invalid_url: true,
        connect_rejected_non_proliferate_host: true,
        only_meta_before_trust: true,
        owner_login_verified: true,
        single_org: true,
      };
      return { status: "green", evidence };
    } finally {
      await page.close().catch(() => undefined);
    }
  },

  async runBaseTurn(world) {
    const owner = driverState(world).owner;
    if (!owner) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: "SH-BASE-TURN requires SH-INSTALL-CLAIM's owner; none was captured on this world.",
        },
      };
    }
    const rawKey = process.env.RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY?.trim();
    if (!rawKey) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: "SH-BASE-TURN: RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY is not set.",
        },
      };
    }
    // Fail-closed preflight (frozen spec): a rejected key is a real red, never
    // blocked/skipped.
    const preflight = await preflightByokKey(rawKey);
    if (!preflight.ok) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `SH-BASE-TURN: BYOK preflight rejected the key (${preflight.reason ?? "unknown reason"}).`,
        },
      };
    }

    const selection = await storeAndSelectByokKey(owner, {
      rawKey,
      harnessKind: REPRESENTATIVE_HARNESS,
      envVarName: DEFAULT_BYOK_ENV_VAR,
    });

    const page = await openAuthenticatedPage(world, owner);
    try {
      await waitForDesktopByokSync(world, page, selection);

      const modelId = await resolveBaseTurnModel(world);
      if (!modelId) {
        return {
          status: "blocked",
          reason: {
            code: "scenario_blocked",
            message: "SH-BASE-TURN: no launchable claude model was offered by the controller-local AnyHarness.",
          },
        };
      }

      const workspacePath = path.join(world.paths.runDir, "selfhost-base-turn-workspace");
      mkdirSync(workspacePath, { recursive: true });
      const created = await world.runtime.client.createLocalWorkspace(workspacePath);
      const session = await world.runtime.client.createSession({
        workspaceId: created.workspace.id,
        agentKind: REPRESENTATIVE_HARNESS,
        modelId,
      });
      await world.runtime.client.prompt(session.id, SELFHOST_TURN_PROMPT);
      const completion = await waitForTurnCompletion(world, session.id, TURN_TIMEOUT_MS);
      if (completion.error) {
        return {
          status: "failed",
          reason: { code: "scenario_failure", message: `SH-BASE-TURN: assistant turn errored: ${completion.error}` },
        };
      }
      if (!completion.ended) {
        return {
          status: "failed",
          reason: { code: "scenario_failure", message: `SH-BASE-TURN: assistant turn did not end within ${TURN_TIMEOUT_MS}ms.` },
        };
      }
      // Reopen: the workspace/session/transcript must remain commandable from
      // the controller-local runtime after the turn.
      const reopened = await world.runtime.client.getSession(session.id);
      if (!reopened || reopened.workspaceId !== created.workspace.id) {
        return {
          status: "failed",
          reason: { code: "scenario_failure", message: "SH-BASE-TURN: session did not remain commandable after reopen." },
        };
      }

      const evidence: SelfHostBaseTurnEvidenceNoCleanup = {
        kind: "selfhost_base_turn",
        artifact_ids: artifactIds(world),
        server_version: world.artifacts.serverImage.version,
        anyharness_version: world.artifacts.anyharness.version,
        harness: "claude",
        api_origin: originOf(world.api.baseUrl),
        controller_runtime_origin: originOf(world.runtime.baseUrl),
        model_id: modelId,
        workspace_id_hash: sha256Hex(created.workspace.id),
        session_id_hash: sha256Hex(session.id),
        transcript_reopened: true,
        byok_route: "api_key",
        byok_key_id_hash: sha256Hex(selection.apiKeyId),
        no_litellm_spend: true,
        no_e2b: true,
      };
      return { status: "green", evidence };
    } finally {
      await page.close().catch(() => undefined);
    }
  },

  async runInvitee(world) {
    const owner = driverState(world).owner;
    if (!owner) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: "SH-INVITEE requires SH-INSTALL-CLAIM's owner; none was captured on this world.",
        },
      };
    }
    const invitee = await inviteAndRegisterMember(world, owner);
    const page = await openAuthenticatedPage(world, invitee);
    try {
      // One authenticated member action: the invitee can list the org's
      // members (a real authenticated read, not merely "the token parses").
      const members = await invitee.api.get<{ members: Array<{ email: string; role: string; status: string }> }>(
        `/v1/organizations/${invitee.organizationId}/members`,
      );
      const self = members.members.find((member) => member.email === invitee.email);
      if (!self || self.role !== "member" || self.status !== "active") {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-INVITEE: invitee is not an active member with role "member" (saw ${JSON.stringify(self)}).`,
          },
        };
      }

      const evidence: SelfHostInviteeEvidenceNoCleanup = {
        kind: "selfhost_invitee",
        artifact_ids: artifactIds(world),
        server_version: world.artifacts.serverImage.version,
        anyharness_version: world.artifacts.anyharness.version,
        harness: "claude",
        api_origin: originOf(world.api.baseUrl),
        controller_runtime_origin: originOf(world.runtime.baseUrl),
        invitee_user_id_hash: sha256Hex(invitee.userId),
        invitation_id_hash: sha256Hex(invitee.invitationId),
        member_role: "member",
        second_page_isolated: true,
        authenticated_member_action: true,
      };
      return { status: "green", evidence };
    } finally {
      await page.close().catch(() => undefined);
    }
  },

  closeWorld: (world) => world.close(),
};

/**
 * The real per-scenario orchestration, independent of the matrix plumbing so it
 * is directly unit-testable against a fake `SelfHostInstallDriver`:
 *   1. resolve world-construction inputs (typed failure → all cells fail clean);
 *   2. build ONE world;
 *   3. run the four cells IN ORDER; a failed `SH-INSTALL-CLAIM` fails the rest
 *      with a bounded prerequisite reason;
 *   4. close the world exactly once and stamp the shared cleanup block into every
 *      cell's evidence, downgrading any green cell to failed if cleanup was not
 *      clean.
 */
export async function runSelfHostInstallCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: SelfHostInstallDriver,
): Promise<ScenarioCellOutcome[]> {
  const inputs = resolveSelfHostWorldInputs(ctx);
  if (!inputs.ok) {
    return cells.map(
      (cell): ScenarioCellOutcome => ({
        cellId: cell.cell_id,
        status: "failed",
        reason: { code: "scenario_failure", message: inputs.reason },
      }),
    );
  }

  let world: ReadySelfHostWorld;
  try {
    world = await driver.buildWorld(inputs.value);
  } catch (error) {
    return cells.map(
      (cell): ScenarioCellOutcome => ({
        cellId: cell.cell_id,
        status: "failed",
        reason: { code: "scenario_failure", message: `world construction failed: ${describe(error)}` },
      }),
    );
  }

  const resultsByCellId = new Map<string, SelfHostCellResult>();
  let installClaimOk = true;

  for (const cellName of SELFHOST_CELL_ORDER) {
    const cell = cells.find((candidate) => candidate.dimensions.cell === cellName);
    if (!cell) {
      continue;
    }
    if (cellName !== SH_INSTALL_CLAIM && !installClaimOk) {
      resultsByCellId.set(cell.cell_id, {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `${SH_INSTALL_CLAIM} did not complete successfully; ${cellName} did not run.`,
        },
      });
      continue;
    }
    let result: SelfHostCellResult;
    try {
      result = await runOneCell(driver, world, cellName);
    } catch (error) {
      result = { status: "failed", reason: { code: "scenario_failure", message: describe(error) } };
    }
    if (cellName === SH_INSTALL_CLAIM && result.status !== "green") {
      installClaimOk = false;
    }
    resultsByCellId.set(cell.cell_id, result);
  }

  let cleanup: SelfHostWorldCleanupEvidence | undefined;
  let closeError: unknown;
  try {
    cleanup = await driver.closeWorld(world);
  } catch (error) {
    closeError = error;
  }

  return cells.map((cell) => {
    const result = resultsByCellId.get(cell.cell_id);
    if (!result) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: { code: "scenario_failure", message: `Self-host cell "${cell.cell_id}" produced no result.` },
      } satisfies ScenarioCellOutcome;
    }
    if (!result.evidence) {
      return { cellId: cell.cell_id, status: result.status, reason: result.reason } satisfies ScenarioCellOutcome;
    }
    if (!cleanup) {
      // World close() itself failed: we cannot produce a complete evidence
      // block (no cleanup summary exists at all), so an otherwise-green cell
      // cannot remain green — the spec's "any run-scoped resource left after
      // teardown → aggregate non-green" applies a fortiori to "we don't even
      // know what was left".
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `World cleanup threw before producing a summary: ${describe(closeError)}`,
        },
      } satisfies ScenarioCellOutcome;
    }
    const evidence = attachCleanupEvidence(result.evidence, cleanup);
    if (result.status === "green" && !cleanupIsClean(cleanup)) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `World cleanup did not fully reconcile (failed=${cleanup.failed}).`,
        },
        evidence,
      } satisfies ScenarioCellOutcome;
    }
    return { cellId: cell.cell_id, status: result.status, reason: result.reason, evidence } satisfies ScenarioCellOutcome;
  });
}

async function runOneCell(
  driver: SelfHostInstallDriver,
  world: ReadySelfHostWorld,
  cellName: SelfHostCellName,
): Promise<SelfHostCellResult> {
  switch (cellName) {
    case SH_INSTALL_CLAIM:
      return driver.runInstallClaim(world);
    case SH_DESKTOP_OWNER:
      return driver.runDesktopOwner(world);
    case SH_BASE_TURN:
      return driver.runBaseTurn(world);
    case SH_INVITEE:
      return driver.runInvitee(world);
    default:
      return { status: "failed", reason: { code: "scenario_failure", message: `Unknown self-host cell "${cellName}".` } };
  }
}

function cleanupIsClean(cleanup: SelfHostWorldCleanupEvidence): boolean {
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

/**
 * Reads the world-construction inputs off the scenario context (candidate map,
 * run identity, run dir, ports) plus the resolved AWS/SSH inputs from the env
 * manifest. Returns a typed failure (never throws) so the cells report clean
 * `failed`/`blocked` outcomes.
 */
export function resolveSelfHostWorldInputs(
  ctx: ScenarioRunContext,
): { ok: true; value: SelfHostWorldConstructionInputs } | { ok: false; reason: string } {
  const map = ctx.candidateBuildMap;
  if (!map) {
    return { ok: false, reason: "no candidate build map was supplied to this run; the cell cannot start a world" };
  }
  if (!ctx.runIdentity) {
    return { ok: false, reason: "no run identity was threaded into the scenario context" };
  }
  if (!ctx.runDir) {
    return { ok: false, reason: "no run/shard-scoped run directory was threaded into the scenario context" };
  }
  if (!ctx.ports) {
    return { ok: false, reason: "no pre-allocated local-world ports were threaded into the scenario context" };
  }
  let region: string;
  let hostedZoneId: string;
  let instanceType: string;
  try {
    region = ctx.env.require("RELEASE_E2E_SELFHOST_REGION");
    hostedZoneId = ctx.env.require("RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID");
    instanceType = ctx.env.require("RELEASE_E2E_SELFHOST_INSTANCE_TYPE");
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
  const sshUser = ctx.env.get("RELEASE_E2E_SELFHOST_SSH_USER")?.trim() || "ubuntu";
  return {
    ok: true,
    value: {
      map,
      run: ctx.runIdentity,
      runDir: ctx.runDir,
      ports: ctx.ports,
      aws: { region, instanceType, hostedZoneId, zone: "qualification.proliferate.com" },
      ssh: { sshUser },
    },
  };
}

/** Stamps the shared world cleanup block into a cell's kind-specific evidence. */
export function attachCleanupEvidence(
  evidence: CellEvidenceNoCleanup,
  cleanup: SelfHostWorldCleanupEvidence,
): CellEvidenceV1 {
  const cleanupBlock = {
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
  return { ...evidence, cleanup: cleanupBlock } as CellEvidenceV1;
}

// ── Small, focused helpers used by the production driver ────────────────────

function artifactIds(world: ReadySelfHostWorld): string[] {
  return [
    world.artifacts.serverImage.artifact_id,
    world.artifacts.bundle.artifact_id,
    world.artifacts.anyharness.artifact_id,
    world.artifacts.desktopRenderer.artifact_id,
  ];
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The safe hostname (never the raw URL/path/credentials) evidence records for an origin. */
/**
 * The browser origins the box's API must admit via CORS so the candidate Desktop
 * renderer and the Connect-Server trust probe can drive the API from a browser:
 * the served renderer origin (127.0.0.1 + localhost forms) plus `null` for the
 * pre-trust connect page, which runs an isolated `about:blank` context whose
 * cross-origin `/meta` fetch carries an opaque (`null`) Origin. Comma-joined, no
 * spaces, so it is a single `--cors-allow-origins` argv token.
 */
function browserOriginsForBox(world: ReadySelfHostWorld): string {
  const rendererOrigin = originUrl(world.renderer.baseUrl);
  const origins = new Set<string>([
    rendererOrigin,
    rendererOrigin.replace("127.0.0.1", "localhost"),
    "null",
  ]);
  return [...origins].join(",");
}

/** The scheme://host[:port] origin of a URL (no path), stable for CORS matching. */
function originUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? url;
  }
}

/**
 * `install.sh --bundle` verifies the bundle against its adjacent
 * `self-hosted-assets.SHA256SUMS` (the exact convention `server-ci.yml
 * self-hosted-release-assets` produces alongside `proliferate-deploy.tar.gz`).
 * ASSUMPTION (disclosed): the builder (workstream B) writes it next to the
 * materialized bundle archive under the same run-owned directory.
 */
function bundleSha256SumsPath(materializedBundlePath: string): string {
  return path.join(path.dirname(materializedBundlePath), "self-hosted-assets.SHA256SUMS");
}

/**
 * The docker repo the self-host candidate builder
 * (`scripts/ci-cd/build-selfhost-qualification-candidates.mjs`) tags the server
 * image with (`docker save`/`docker load` round-trips on `<repo>:<version>`).
 * The candidate map carries a bare `<version>` for the `server/linux/<arch>`
 * artifact (clean semver so evidence `server_version` stays honest), so the
 * loaded image ref is this fixed repo plus that version.
 */
const CANDIDATE_SERVER_IMAGE_REPO = "proliferate-server-qualification";

/**
 * Derives the `<repo>:<tag>` the box's `docker load` restores from the server
 * artifact's version. A colon-bearing version is honored verbatim; a bare
 * version (the builder's normal output) pairs with the fixed candidate repo
 * above. The docker-loaded candidate tag must never be `stable`/`latest`.
 */
function splitCandidateImageRef(serverImage: { version: string }): { repo: string; tag: string } {
  const value = serverImage.version;
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === value.length - 1) {
    return { repo: CANDIDATE_SERVER_IMAGE_REPO, tag: value };
  }
  return { repo: value.slice(0, lastColon), tag: value.slice(lastColon + 1) };
}

/** Opens a fresh, unauthenticated isolated page (Connect-Server trust flow, pre-login). */
async function openIsolatedPage(world: ReadySelfHostWorld): Promise<ProductPage> {
  const context = await world.renderer.browser.newContext();
  const page = await context.newPage();
  return wrapPage(context, page);
}

/** Opens an isolated page with a real product session pre-installed and reloaded authenticated. */
async function openAuthenticatedPage(
  world: ReadySelfHostWorld,
  actor: { session: unknown },
): Promise<ProductPage> {
  const context = await world.renderer.browser.newContext();
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(actor.session) },
  );
  const page = await context.newPage();
  await page.goto(world.renderer.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(AUTHENTICATED_READINESS_SELECTOR).first().waitFor({ state: "visible", timeout: 30_000 });
  return wrapPage(context, page);
}

/** Installs a session into an already-open (trusted, pre-login) page and reloads to authenticated readiness. */
async function installSessionAndReload(page: ProductPage, session: unknown): Promise<void> {
  await page.context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(session) },
  );
  await page.page.reload({ waitUntil: "domcontentloaded" });
  await page.page.locator(AUTHENTICATED_READINESS_SELECTOR).first().waitFor({ state: "visible", timeout: 30_000 });
}

function wrapPage(context: BrowserContext, page: Page): ProductPage {
  return {
    context,
    page,
    debug: { console: [], network: [] },
    close: async () => {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    },
  };
}

/** ASSUMPTION (disclosed): the controller-local runtime's launch-options order is cheapest-first, per catalog convention. */
async function resolveBaseTurnModel(world: ReadySelfHostWorld): Promise<string | undefined> {
  const options = await world.runtime.client.getAgentLaunchOptions();
  const entry = options.find((agent) => agent.kind === REPRESENTATIVE_HARNESS);
  return entry?.models[0]?.id;
}

/** Polls AnyHarness's session event stream until the turn ends or errors. */
async function waitForTurnCompletion(
  world: ReadySelfHostWorld,
  sessionId: string,
  timeoutMs: number,
): Promise<{ ended: boolean; error: string | undefined }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await world.runtime.client.getEvents(sessionId).catch(() => []);
    const errorEvent = events.find((entry) => entry.event.type === "error");
    if (errorEvent) {
      return { ended: true, error: String((errorEvent.event as { message?: string }).message ?? "unknown error") };
    }
    if (events.some((entry) => entry.event.type === "turn_ended")) {
      return { ended: true, error: undefined };
    }
    await sleep(1_000);
  }
  return { ended: false, error: undefined };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
