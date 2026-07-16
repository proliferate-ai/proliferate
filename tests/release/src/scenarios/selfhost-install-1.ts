import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
import { candidateChildEnvironment } from "../artifacts/anyharness-smoke.js";
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
  inviteeEmail,
  registerInvitee,
  type SelfHostOwnerActor,
} from "../fixtures/selfhost-actor.js";
import {
  DEFAULT_BYOK_ENV_VAR,
  preflightByokKey,
  storeAndSelectByokKey,
  waitForDesktopByokSync,
  type ByokPreflightResult,
  type ByokSelection,
} from "../fixtures/byok.js";
import { defaultPreparedRepositoryTransport } from "../fixtures/prepared-repository.js";
import {
  assertOnlyMetaFetchedBeforeTrust,
  assertRejectsInvalidUrl,
  assertRejectsNonProliferateHost,
  connectProbePageUrl,
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
/** SHR-004a: the SH-BASE-TURN transcript re-read after reload must contain the assistant's reply to `SELFHOST_TURN_PROMPT`. */
const EXPECTED_TURN_REPLY_PATTERN = /pong/i;
/**
 * SHR-004b: known LiteLLM/gateway env var names
 * (`tests/release/src/config/env-manifest.ts`). SH-BASE-TURN's world is
 * BYOK-only — `SELFHOST_REQUIRED_ENV` above carries no gateway input — so
 * observing their absence from the SCRUBBED candidate child env (the env the
 * candidate AnyHarness actually receives) is part of the "world was constructed
 * with no LiteLLM env configured" half of `no_litellm_spend`. The check is
 * scoped to the candidate env, not the test runner's ambient env: the full
 * strict lane sources one qualification-infra.env for all scenarios, so the
 * runner legitimately carries the gateway inputs the sibling SELFHOST-QUAL-1
 * cell needs — the allowlisting candidateChildEnvironment drops them here.
 */
const LITELLM_GATEWAY_ENV_VARS = [
  "RELEASE_E2E_GATEWAY_TEST_KEY",
  "AGENT_GATEWAY_LITELLM_BASE_URL",
  "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
  "AGENT_GATEWAY_LITELLM_MASTER_KEY",
] as const;

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
        { description: `${prefix} reload the renderer and re-read the same session's transcript; observe /meta + runtime auth state confirm no LiteLLM/E2B` },
      ];
    case SH_INVITEE:
      return [
        { description: `${prefix} owner invites a member through the product UI; capture the invitation` },
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

    // Advertised-version truth (frozen spec: "assert advertised candidate
    // versions match the map"). The OBSERVED running server version (from /meta
    // serverVersion) must equal the candidate map's server artifact version, or
    // the box came up on something other than the exact candidate bytes. Fail
    // closed BEFORE any claim, like a digest mismatch.
    const candidateServerVersion = world.artifacts.serverImage.version;
    if (receipt.serverVersion !== candidateServerVersion) {
      return {
        status: "failed",
        reason: {
          code: "scenario_failure",
          message:
            `SH-INSTALL-CLAIM: the running server advertises version "${receipt.serverVersion}", ` +
            `but the candidate map pins "${candidateServerVersion}"; refusing to claim a mismatched build.`,
        },
      };
    }

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
      candidate_server_version: candidateServerVersion,
      server_version_matches_candidate: true,
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
      await installSessionAndReload(page, owner.session, world.renderer.baseUrl);
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
    return runBaseTurnCell(world, owner, defaultBaseTurnCellOps);
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
    // SHR-001: the CREATE goes through the real renderer UI, never a direct
    // API POST — drive the owner's authenticated Members/Invitations settings
    // surface and submit the invite-by-email form. The API is used only to
    // READ the created invitation's registration token back (matching the
    // shipped self-host smoke's own token-recovery pattern), never to create it.
    const email = inviteeEmail(world);
    const invitePage = await openOwnerMembersSettingsPage(world, owner);
    let createdInvitation: { id: string; email: string; status: string };
    try {
      await inviteMemberThroughUi(invitePage, email);
      createdInvitation = await readCreatedInvitation(owner, email);
    } finally {
      await invitePage.close().catch(() => undefined);
    }
    const invitee = await registerInvitee(world, owner, createdInvitation);
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

// ── SH-BASE-TURN cell logic (ops injected; decision logic is offline-tested) ──

/**
 * The privileged/stateful/UI-driving steps of SH-BASE-TURN, factored out behind
 * an injectable seam so `runBaseTurnCell`'s decision logic is unit-testable
 * OFFLINE (no real Anthropic/browser/AnyHarness), mirroring `GatewayCellOps`
 * in the sibling SELFHOST-QUAL-1. Production wiring (`defaultBaseTurnCellOps`)
 * calls the real fixtures + the UI-real turn machinery.
 */
/**
 * The result of a UI-real "Work locally" turn. `workspaceId` is the runtime's
 * MATERIALIZED workspace id (what sessions/getSession key off, and what the
 * evidence receipt hashes); `logicalWorkspaceId` is the product's LOGICAL
 * ui-key (`repo-root:<repoRootId>:<branch>`) the DOM re-renders on reload. The
 * two are distinct handles and MUST NOT be conflated.
 */
export interface LocalWorkspaceTurn {
  workspaceId: string;
  logicalWorkspaceId: string;
  sessionId: string;
  reply: string;
}

export interface BaseTurnCellOps {
  /** The run-scoped BYOK key from the controller env (never stored/logged). */
  resolveByokRawKey(): string | undefined;
  /** Fail-closed provider preflight (real bounded call; offline-faked in tests). */
  preflightByok(rawKey: string): Promise<ByokPreflightResult>;
  /** Store + select the run-scoped key through the product (surface=local, api_key). */
  storeAndSelectByok(owner: SelfHostOwnerActor, rawKey: string): Promise<ByokSelection>;
  /** Open the authenticated owner's Desktop renderer page. */
  openOwnerPage(world: ReadySelfHostWorld, owner: SelfHostOwnerActor): Promise<ProductPage>;
  /** Wait for Desktop to push the api_key source into the controller-local runtime (throws on timeout). */
  waitForByokSync(world: ReadySelfHostWorld, page: ProductPage, selection: ByokSelection): Promise<void>;
  /** Secret-free runtime auth-state diagnostic for a sync timeout. */
  summarizeAuthState(world: ReadySelfHostWorld, harnessKind: string): string;
  /** Cheapest eligible non-premium claude model from the controller-local runtime. */
  resolveModel(world: ReadySelfHostWorld): Promise<string | undefined>;
  /**
   * UI-REAL: through the renderer composer, create the local workspace + session
   * and send the prompt, waiting for the assistant reply in the transcript DOM.
   * Throws (bounded) on a create/turn failure. Returns the UI-created ids (as
   * observed via the runtime's own session list) and the rendered reply text.
   */
  createWorkspaceTurnThroughUi(
    world: ReadySelfHostWorld,
    page: ProductPage,
    modelId: string,
    prompt: string,
  ): Promise<LocalWorkspaceTurn>;
  /** Runtime-side reopen: the session must remain commandable (secondary observation). */
  reopenSession(world: ReadySelfHostWorld, sessionId: string): Promise<{ workspaceId?: string } | undefined>;
  /**
   * SHR-004a: reload the SAME renderer page product-native (NO localStorage
   * preset — the product persisted its own selection when the workspace was
   * created through the UI) and re-read the transcript. A failure to restore is
   * a real product finding reported with a bounded, diagnosable message.
   */
  reloadTranscript(
    world: ReadySelfHostWorld,
    page: ProductPage,
    workspaceId: string,
  ): Promise<{ ok: true; text: string } | { ok: false; diagnostic: string }>;
  /** SHR-004b/c: the server's advertised gateway/cloud capability booleans. */
  fetchCapabilities(world: ReadySelfHostWorld): Promise<SelfHostMetaCapabilities>;
  /** SHR-004b: the auth source kinds Desktop pushed into the controller-local runtime. */
  readAuthSourceKinds(world: ReadySelfHostWorld, harnessKind: string): string[];
  /** The LiteLLM gateway env var present on the controller env, if any. */
  detectGatewayEnvVar(): string | undefined;
  /** The E2B key present in the scrubbed candidate child env, if any. */
  detectE2bEnvKey(): string | undefined;
}

/**
 * SH-BASE-TURN decision logic (frozen tier-3 contract §`SH-BASE-TURN`):
 * store+select a run-scoped user API key through the self-host product, then
 * CREATE the local workspace, session, and turn ALL through the real Desktop
 * renderer composer against the controller-local candidate AnyHarness (the
 * UI-real path the contract names — "create a local workspace through the
 * Desktop renderer and separate candidate AnyHarness"). The runtime-side
 * assertions (session remains commandable; no LiteLLM/E2B) are kept as
 * secondary OBSERVATIONS off the UI-created entities. SHR-004a's reopen proof
 * is product-native: a plain reload restores the product's own persisted
 * workspace selection; a failure to restore is a bounded, diagnosable red.
 */
export async function runBaseTurnCell(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  ops: BaseTurnCellOps,
): Promise<SelfHostCellResult> {
  const rawKey = ops.resolveByokRawKey();
  if (!rawKey) {
    return failedBaseTurn("SH-BASE-TURN: RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY is not set.");
  }
  // Fail-closed preflight (frozen spec): a rejected key is a real red, never
  // blocked/skipped.
  const preflight = await ops.preflightByok(rawKey);
  if (!preflight.ok) {
    return failedBaseTurn(`SH-BASE-TURN: BYOK preflight rejected the key (${preflight.reason ?? "unknown reason"}).`);
  }

  const selection = await ops.storeAndSelectByok(owner, rawKey);

  const page = await ops.openOwnerPage(world, owner);
  try {
    try {
      await ops.waitForByokSync(world, page, selection);
    } catch (error) {
      // Enrich the timeout with whether the Desktop push actually landed in the
      // controller-local runtime home (Layer A vs Layer B): source kinds +
      // env-var names only, never the raw key value.
      const diag = ops.summarizeAuthState(world, selection.harnessKind);
      throw new Error(`${describe(error)} ${diag}`);
    }

    const modelId = await ops.resolveModel(world);
    if (!modelId) {
      return {
        status: "blocked",
        reason: {
          code: "scenario_blocked",
          message: "SH-BASE-TURN: no launchable claude model was offered by the controller-local AnyHarness.",
        },
      };
    }

    // UI-REAL: workspace + session + prompt all go through the renderer composer.
    let turn: LocalWorkspaceTurn;
    try {
      turn = await ops.createWorkspaceTurnThroughUi(world, page, modelId, SELFHOST_TURN_PROMPT);
    } catch (error) {
      // Render the ui-turn step BEFORE the "failed:" boundary so it survives
      // evidence redaction (which withholds everything after that colon).
      const step = (error as { uiTurnStep?: string })?.uiTurnStep;
      const at = step ? ` at step "${step}"` : "";
      return failedBaseTurn(
        `SH-BASE-TURN: creating the local workspace and running the turn through the renderer${at} failed: ${describe(error)}`,
      );
    }
    if (!EXPECTED_TURN_REPLY_PATTERN.test(turn.reply)) {
      return failedBaseTurn(
        `SH-BASE-TURN: the renderer transcript did not render the turn's reply (saw ${JSON.stringify(turn.reply)}).`,
      );
    }

    // Reopen (runtime, secondary observation): the UI-created workspace/session
    // must remain commandable from the controller-local runtime after the turn.
    const reopened = await ops.reopenSession(world, turn.sessionId);
    if (!reopened || reopened.workspaceId !== turn.workspaceId) {
      return failedBaseTurn("SH-BASE-TURN: session did not remain commandable after reopen.");
    }

    // SHR-004a: `transcript_reopened` must be OBSERVED — reload the renderer
    // product-native (no preset) and re-read the SAME workspace's transcript.
    // The DOM re-renders the LOGICAL ui-key, so the reload match keys off it,
    // not the runtime's materialized workspace id.
    const reloaded = await ops.reloadTranscript(world, page, turn.logicalWorkspaceId);
    if (!reloaded.ok) {
      return failedBaseTurn(
        `SH-BASE-TURN: after a product-native page reload the renderer did not restore the workspace/transcript — ${reloaded.diagnostic}`,
      );
    }
    if (!EXPECTED_TURN_REPLY_PATTERN.test(reloaded.text)) {
      return failedBaseTurn(
        `SH-BASE-TURN: the renderer's re-read transcript after a fresh page load did not contain the turn's reply (saw ${JSON.stringify(reloaded.text)}).`,
      );
    }

    // SHR-004b/c: `no_litellm_spend`/`no_e2b` must be OBSERVED, not merely
    // asserted by construction.
    const capabilities = await ops.fetchCapabilities(world);
    if (capabilities.agentGateway) {
      return failedBaseTurn(
        "SH-BASE-TURN: /meta reports capabilities.agentGateway=true; expected the self-host instance to advertise it disabled.",
      );
    }
    if (capabilities.cloudWorkspaces) {
      return failedBaseTurn(
        "SH-BASE-TURN: /meta reports capabilities.cloudWorkspaces=true; expected the self-host instance to advertise it disabled.",
      );
    }
    const gatewayEnvVar = ops.detectGatewayEnvVar();
    if (gatewayEnvVar) {
      return failedBaseTurn(
        `SH-BASE-TURN: the world's scrubbed candidate child env carries "${gatewayEnvVar}"; a BYOK-only self-host run must configure no LiteLLM gateway input.`,
      );
    }
    const authSourceKinds = ops.readAuthSourceKinds(world, selection.harnessKind);
    if (!authSourceKinds.includes("api_key")) {
      return failedBaseTurn(
        `SH-BASE-TURN: the pushed BYOK auth state for "${selection.harnessKind}" does not carry an "api_key" source (saw ${JSON.stringify(authSourceKinds)}).`,
      );
    }
    if (authSourceKinds.includes("gateway")) {
      return failedBaseTurn(
        `SH-BASE-TURN: the pushed BYOK auth state for "${selection.harnessKind}" carries a "gateway" (LiteLLM virtual-key) source; a BYOK-direct turn must show only "api_key" (saw ${JSON.stringify(authSourceKinds)}).`,
      );
    }
    const e2bEnvKey = ops.detectE2bEnvKey();
    if (e2bEnvKey) {
      return failedBaseTurn(
        `SH-BASE-TURN: the world's scrubbed candidate child env carries an E2B key ("${e2bEnvKey}"); expected none.`,
      );
    }

    // The checks above prove this TURN was BYOK-DIRECT (capabilities gateway/cloud
    // both false, the pushed auth route is `api_key` not `gateway`, and the
    // scrubbed candidate env carries no LiteLLM/E2B input). They do NOT constitute
    // the frozen contract's run-window SPEND/TRAFFIC observation of
    // `no_litellm_spend`/`no_e2b`, which PR 7 cannot perform for a gateway-OFF
    // base install. So those two claims are recorded HONESTLY as "unproven"
    // rather than asserted from configuration or from an unavailable/false
    // container probe (PR7-CONTROL-010 — an earlier catch-to-empty container
    // observation could false-green and has been removed).

    const evidence: SelfHostBaseTurnEvidenceNoCleanup = {
      kind: "selfhost_base_turn",
      artifact_ids: artifactIds(world),
      server_version: world.artifacts.serverImage.version,
      anyharness_version: world.artifacts.anyharness.version,
      harness: "claude",
      api_origin: originOf(world.api.baseUrl),
      controller_runtime_origin: originOf(world.runtime.baseUrl),
      model_id: modelId,
      workspace_id_hash: sha256Hex(turn.workspaceId),
      session_id_hash: sha256Hex(turn.sessionId),
      transcript_reopened: true,
      byok_route: "api_key",
      byok_key_id_hash: sha256Hex(selection.apiKeyId),
      // Honest claim status (PR7-CONTROL-010): the frozen run-window spend/traffic
      // observation is not performed by PR 7 for a gateway-OFF base install, so
      // these are "unproven" rather than a false absence assertion.
      no_litellm_spend: "unproven",
      no_e2b: "unproven",
    };
    return { status: "green", evidence };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function failedBaseTurn(message: string): SelfHostCellResult {
  return { status: "failed", reason: { code: "scenario_failure", message } };
}

/** Production wiring: real fixtures + the UI-real turn machinery. */
export const defaultBaseTurnCellOps: BaseTurnCellOps = {
  resolveByokRawKey: () => process.env.RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY?.trim() || undefined,
  preflightByok: (rawKey) => preflightByokKey(rawKey),
  storeAndSelectByok: (owner, rawKey) =>
    storeAndSelectByokKey(owner, {
      rawKey,
      harnessKind: REPRESENTATIVE_HARNESS,
      envVarName: DEFAULT_BYOK_ENV_VAR,
    }),
  openOwnerPage: (world, owner) => openAuthenticatedPage(world, owner),
  waitForByokSync: (world, page, selection) => waitForDesktopByokSync(world, page, selection),
  summarizeAuthState: (world, harnessKind) => summarizeRuntimeAuthState(world.paths.runtimeHome, harnessKind),
  resolveModel: (world) => resolveBaseTurnModel(world),
  createWorkspaceTurnThroughUi: (world, page, modelId, prompt) =>
    createLocalWorkspaceTurnThroughUi(world, page, modelId, prompt, "selfhost-base-turn-workspace"),
  async reopenSession(world, sessionId) {
    return world.runtime.client.getSession(sessionId).catch(() => undefined);
  },
  reloadTranscript: (world, page, workspaceId) => reloadTranscriptProductNative(world, page, workspaceId),
  fetchCapabilities: (world) => fetchServerCapabilities(world),
  readAuthSourceKinds: (world, harnessKind) => readRuntimeAuthSourceKinds(world.paths.runtimeHome, harnessKind),
  detectGatewayEnvVar: () => {
    // Assert on the SCRUBBED candidate child env (what the candidate AnyHarness
    // actually receives via candidateChildEnvironment), not the test runner's
    // ambient process.env. The full self-host strict lane sources ONE
    // qualification-infra.env for all scenarios, so the runner env legitimately
    // carries AGENT_GATEWAY_LITELLM_* for the sibling SELFHOST-QUAL-1 gateway
    // cell; the allowlisting candidateChildEnvironment drops those before they
    // could reach the BYOK-only candidate runtime, which is exactly what
    // no_litellm_spend must prove. Mirrors the E2B-key guard's scope AND its
    // pattern-scan shape: match any surviving gateway-ish key (the four known
    // names plus anything containing litellm/agent_gateway), not a fixed list,
    // so a differently-named gateway var that slipped into the allowlist is
    // still caught.
    const candidateEnv = candidateChildEnvironment(process.env);
    return Object.keys(candidateEnv).find(
      (key) =>
        (LITELLM_GATEWAY_ENV_VARS as readonly string[]).includes(key) || /litellm|agent_gateway/i.test(key),
    );
  },
  detectE2bEnvKey: () => Object.keys(candidateChildEnvironment(process.env)).find((key) => /e2b/i.test(key)),
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
 * the served renderer origin (127.0.0.1 + localhost forms). No `null` origin: the
 * pre-trust Connect-Server probes now run from a page loaded ON the renderer
 * origin (a real browser origin already admitted by CORS), not an `about:blank`
 * context, so their cross-origin `/meta` fetches carry the renderer Origin.
 * These EXTEND the shipped Tauri/localhost defaults on the box (install.sh
 * merges + dedupes). Comma-joined, no spaces, so it is a single
 * `--cors-allow-origins` argv token.
 */
export function browserOriginsForBox(world: ReadySelfHostWorld): string {
  return rendererLoopbackOrigins(world.renderer.baseUrl).join(",");
}

/**
 * Both loopback host forms (127.0.0.1 AND localhost) of the renderer origin,
 * sharing its scheme + port, exact-deduped and first-seen ordered. The renderer
 * may bind on EITHER form, and the box's CORS must admit both regardless of which
 * one it bound on: a plain `127.0.0.1 -> localhost` string replace drops the
 * 127.0.0.1 origin when the renderer already bound on localhost, so parse the
 * origin and emit both variants explicitly. Non-loopback origins are passed
 * through unchanged (only a single entry).
 */
function rendererLoopbackOrigins(rendererBaseUrl: string): string[] {
  const origin = originUrl(rendererBaseUrl);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return [origin];
  }
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    return [origin];
  }
  const out: string[] = [];
  for (const host of ["127.0.0.1", "localhost"]) {
    const variant = new URL(origin);
    variant.hostname = host;
    if (!out.includes(variant.origin)) {
      out.push(variant.origin);
    }
  }
  return out;
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

/**
 * Opens a fresh, unauthenticated isolated page (Connect-Server trust flow,
 * pre-login) and navigates it to the BARE, same-origin connect-probe page served
 * by the renderer static server (`connectProbePageUrl`), NOT the full SPA. The
 * pre-trust `/meta` probes are `fetch`es issued from this page's document
 * context, so loading a real renderer-origin document (instead of leaving it on
 * `about:blank`) means those cross-origin fetches carry the renderer Origin — a
 * real browser origin already admitted by the box's CORS — rather than an opaque
 * `null` Origin. That is why the box no longer needs a `null` CORS entry
 * (SHR-007). Crucially, the probe page loads NO app bundle, so the product SPA
 * never boots and never fires its own startup traffic (`/health`, telemetry,
 * auth discovery) at the instance before trust — the `assertOnlyMetaFetched-
 * BeforeTrust` invariant holds. The page is unauthenticated (no session in
 * storage) and issues no request to the instance origin before the trust probes.
 */
async function openIsolatedPage(world: ReadySelfHostWorld): Promise<ProductPage> {
  const context = await world.renderer.browser.newContext();
  const page = await context.newPage();
  await page.goto(connectProbePageUrl(world.renderer.baseUrl), { waitUntil: "domcontentloaded" });
  return wrapPage(context, page);
}

/**
 * Opens an isolated page with a real product session pre-installed and reloaded
 * authenticated. Exported (export-only, no behavior change) so the sibling
 * SELFHOST-QUAL-1 `SH-GATEWAY` cell opens the freshly-enrolled actor's renderer
 * with the identical machinery SH-BASE-TURN uses.
 */
export async function openAuthenticatedPage(
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

/**
 * SHR-001: opens an authenticated page navigated directly at the org
 * Members/Invitations settings surface (`/settings?section=organization-members`
 * — the real route `SidebarAccountFooter.tsx`'s "Settings" menu item navigates
 * to; `AuthenticatedAppHost.tsx` keeps the home shell mounted underneath it, so
 * `AUTHENTICATED_READINESS_SELECTOR` still resolves). Renders
 * `OrganizationMembersPane` → `OrganizationInvitationsSection`
 * (apps/packages/product-client/src/components/settings/panes/organization/).
 */
async function openOwnerMembersSettingsPage(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
): Promise<ProductPage> {
  const context = await world.renderer.browser.newContext();
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(owner.session) },
  );
  const page = await context.newPage();
  await page.goto(`${world.renderer.baseUrl}/settings?section=organization-members`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(AUTHENTICATED_READINESS_SELECTOR).first().waitFor({ state: "visible", timeout: 30_000 });
  return wrapPage(context, page);
}

/**
 * SHR-001: submits the invite-by-email form on the Members/Invitations
 * settings surface. The product ships almost no `data-testid`s on this surface
 * (see `product-page.ts`'s module doc on the same gap for the home/workspace
 * shell) — `OrganizationInvitationsSection.tsx`'s email `<Input>` carries
 * `aria-label="Invite email"` and the submit `<Button>` reads "Send
 * invitation"; those accessible-name hooks are the most resilient selectors
 * available. Waits for the form's own success signal: `handleInvite`
 * (`OrganizationMembersPane.tsx`) only resets the controlled email input to ""
 * after `createInvitation` resolves — a rejected create leaves it populated and
 * throws, so a persistently non-empty value is a real failure, not a race.
 */
async function inviteMemberThroughUi(page: ProductPage, email: string): Promise<void> {
  const p = page.page;
  const emailInput = p.locator('input[aria-label="Invite email"]');
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  await emailInput.fill(email);
  const submit = p.getByRole("button", { name: "Send invitation" });
  await submit.waitFor({ state: "visible", timeout: 10_000 });
  await submit.click();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await emailInput.inputValue().catch(() => email);
    if (value === "") {
      return;
    }
    await sleep(500);
  }
  throw new Error(
    `inviteMemberThroughUi: the invite form never confirmed success for "${email}" within 30000ms ` +
      `(the email input still reads a non-empty value).`,
  );
}

/**
 * SHR-001: reads the invitation the UI just created back over the product API
 * (the invitation id doubles as the registration token — see
 * `registerInvitee` in `fixtures/selfhost-actor.ts`). This is a READ only: the
 * CREATE already happened through the UI in `inviteMemberThroughUi`, matching
 * the shipped self-host smoke's own token-recovery pattern
 * (`server/deploy/smoke/run-smoke.sh`).
 */
async function readCreatedInvitation(
  owner: SelfHostOwnerActor,
  email: string,
): Promise<{ id: string; email: string; status: string }> {
  const response = await owner.api.get<{ invitations: Array<{ id: string; email: string; status: string }> }>(
    `/v1/organizations/${encodeURIComponent(owner.organizationId)}/invitations`,
  );
  const invitation = response.invitations.find((entry) => entry.email === email);
  if (!invitation) {
    throw new Error(`readCreatedInvitation: no invitation for "${email}" was found after the UI submit.`);
  }
  return invitation;
}

/**
 * Installs a session into an already-open (trusted, pre-login) isolated page and
 * boots it authenticated. `openIsolatedPage` already loaded a bare page on the
 * renderer origin (that is where the pre-trust `/meta` probes ran from), but with
 * no session in storage and no app bundle. An `addInitScript` only takes effect
 * on the NEXT navigation, so this installs the session then navigates to the FULL
 * renderer SPA (post-trust, boot traffic is fine here) to boot it authenticated,
 * and waits for authenticated readiness.
 */
async function installSessionAndReload(
  page: ProductPage,
  session: unknown,
  rendererBaseUrl: string,
): Promise<void> {
  await page.context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(session) },
  );
  await page.page.goto(rendererBaseUrl, { waitUntil: "domcontentloaded" });
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

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/** Bounded UI waits for the composer-driven turn (kept generous but finite). */
const HOME_COMPOSER_TIMEOUT_MS = 60_000;
const MODEL_PICKER_TIMEOUT_MS = 60_000;
const WORKSPACE_SETTLE_TIMEOUT_MS = 90_000;
const ASSISTANT_REPLY_TIMEOUT_MS = 30_000;
const RELOAD_SHELL_TIMEOUT_MS = 60_000;

/**
 * SHR-004a / frozen tier-3 contract §`SH-BASE-TURN` ("create a local workspace
 * through the Desktop renderer and separate candidate AnyHarness"): drives the
 * REAL renderer composer to create the local workspace + session and run one
 * bounded turn — the identical machinery `local-world-smoke-1.ts` uses for its
 * UI-real local turn, just against the self-host world's controller-local
 * AnyHarness (the composer/workspace-entry UI is the same product renderer).
 *
 * Sequence (mirrors LOCAL-WORLD-SMOKE-1's Project→Work-locally→model→send flow):
 *   1. register a run-scoped repo-root under `runDir` in the controller-local
 *      AnyHarness (the same `POST /v1/repo-roots/resolve` path the Desktop folder
 *      picker uses, reused verbatim from `preparedRepository`'s transport). A
 *      repo-root REQUIRES a git repository (AnyHarness returns `NotGitRepo`
 *      otherwise — `anyharness/.../api/http/repo_roots.rs`), so the dir is
 *      `git init`'d with one empty baseline commit. This is prerequisite fixture
 *      state (the workspace/session/turn under test are created by the UI below),
 *      exactly like `preparedRepository`;
 *   2. reload so the composer re-fetches repo-roots + launch options, then pick
 *      the repo in the "Project:" menu and choose "Work locally" in the
 *      "Runtime:" menu (`HomeProjectMenu.tsx` `data-repo-source-root`,
 *      `home-target-picker.ts` "Work locally");
 *   3. select the resolved model in the composer picker
 *      (`ComposerModelSelectorControl.tsx` `data-composer-model-trigger` /
 *      `data-model-option`);
 *   4. send the prompt (`HomeComposerForm.tsx` `data-home-composer-editor`,
 *      `ChatComposerActions.tsx` `data-chat-send-button`); the pending-workspace
 *      composer MATERIALIZES the workspace + session and runs the first turn;
 *   5. read the settled workspace ui-key off the shell
 *      (`StandardWorkspaceShell.tsx` `data-workspace-shell` /
 *      `data-workspace-ui-key` / `data-pending-workspace`), resolve the
 *      AnyHarness session id from the runtime's own session list, drive the turn
 *      to completion off the runtime event stream, and read the assistant reply
 *      from the transcript DOM (`TranscriptItemBlock.tsx` `data-assistant-prose`
 *      / `data-assistant-streaming`).
 *
 * Exported (pure move/export) so the sibling SELFHOST-QUAL-1 `SH-GATEWAY` cell
 * runs its one gateway-routed turn through the identical UI-real path.
 */
export async function createLocalWorkspaceTurnThroughUi(
  world: ReadySelfHostWorld,
  page: ProductPage,
  modelId: string,
  prompt: string,
  workspaceDirName: string,
): Promise<LocalWorkspaceTurn> {
  const p = page.page;
  // Failure attribution: evidence redaction withholds response bodies, so a
  // bare rethrow loses WHERE the flow died. `step` is a bounded label carried
  // in the thrown message; a failure also drops one screenshot into the run's
  // uploaded logs/ dir. Neither carries a response body or secret.
  let step = "prepare repo root";
  try {
    return await createLocalWorkspaceTurnThroughUiInner(world, page, modelId, prompt, workspaceDirName, (s) => {
      step = s;
    });
  } catch (error) {
    // Durable screenshot: runDir/logs is reconciled away at teardown, so a
    // failed run's screenshot only survives if a durable debug dir is set
    // (local diagnostic runs export LOCAL_WORLD_SMOKE_DEBUG_DIR). Also drop the
    // per-run copy for Actions log upload while the run dir still exists.
    const shotName = `ui-turn-failure-${workspaceDirName}.png`;
    const debugDir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
    const shotPaths = [path.join(world.paths.runDir, "logs", shotName)];
    if (debugDir) {
      shotPaths.push(path.join(debugDir, `${world.run.run_id}-${world.run.shard_id}-${shotName}`));
    }
    for (const shot of shotPaths) {
      try {
        mkdirSync(path.dirname(shot), { recursive: true });
      } catch {
        // best-effort diagnostic path
      }
      await p.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    // Raw diagnostic to the console only (never persisted evidence): the full
    // message + stack survive in the run log even though evidence redaction
    // withholds the payload after the "failed:" boundary.
    console.error(`[ui-turn raw diag] step="${step}" workspace="${workspaceDirName}"\n${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    // Correlation diagnostic: the runtime's sessions + workspaces + the DOM's
    // ui-key/session-id reveal whether the UI turn ran on world.runtime and how
    // the ui-key relates to the runtime workspaceId. Ids are opaque handles.
    try {
      const sessions = await world.runtime.client.listSessions().catch(() => []);
      const workspaces = await world.runtime.client.listWorkspaces().catch(() => []);
      const domUiKeys = await p
        .locator("[data-workspace-shell]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-workspace-ui-key")))
        .catch(() => [] as Array<string | null>);
      console.error(
        `[ui-turn raw diag] runtime sessions=${JSON.stringify(
          sessions.map((s) => ({ id: s.id, workspaceId: s.workspaceId, status: s.status })),
        )} runtime workspaces=${JSON.stringify(
          workspaces.map((w) => ({ id: w.id, kind: w.kind, repoRootId: w.repoRootId, branch: w.currentBranch })),
        )} dom ui-keys=${JSON.stringify(domUiKeys)}`,
      );
    } catch {
      // best-effort correlation diagnostic
    }
    // Carry the step in a property so the cell-level catch can render it
    // BEFORE the "failed:" redaction boundary (the label after that colon is
    // stripped by evidence redaction).
    const wrapped = new Error(message) as Error & { uiTurnStep?: string };
    wrapped.uiTurnStep = step;
    throw wrapped;
  }
}

async function createLocalWorkspaceTurnThroughUiInner(
  world: ReadySelfHostWorld,
  page: ProductPage,
  modelId: string,
  prompt: string,
  workspaceDirName: string,
  setStep: (step: string) => void,
): Promise<LocalWorkspaceTurn> {
  const p = page.page;

  // 1. Prerequisite repo-root under runDir (git repo required by AnyHarness).
  const repoPath = await prepareLocalRepoRoot(world, workspaceDirName);

  setStep("reload home composer");
  // 2. Reload so the freshly-registered repo-root + launch options are re-fetched
  //    by the (already-open) composer, then wait for the home composer to render.
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator("[data-home-composer-editor]").first().waitFor({ state: "visible", timeout: HOME_COMPOSER_TIMEOUT_MS });

  setStep("select repo in Project picker");
  // Select the repo in the Project picker and "Work locally" in the Runtime picker.
  await clickByRole(p, "button", /^Project:/, "home Project picker trigger");
  const repoRow = p.locator(`[data-repo-source-root="${cssAttr(repoPath)}"]`).first();
  await repoRow.waitFor({ state: "visible", timeout: 20_000 });
  await repoRow.click();
  setStep("select Work locally runtime");
  await clickByRole(p, "button", /^Runtime:/, "home Runtime picker trigger");
  await clickMenuItemByText(p, "Work locally", '"Work locally" runtime option');

  setStep("select model in composer");
  // 3. Select the resolved model in the composer picker.
  await selectModelInComposer(p, modelId);

  setStep("send prompt");
  // 4. Send the prompt; the pending-workspace composer materializes the workspace.
  const editor = p.locator("[data-home-composer-editor]").first();
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  await editor.fill(prompt);
  const send = p.locator("[data-chat-send-button]:not([disabled])").first();
  await send.waitFor({ state: "visible", timeout: 15_000 });
  await send.click();

  setStep("wait for workspace shell to settle");
  // 5. Wait for the shell to settle (data-pending-workspace flips to "false"),
  //    then read the DOM ui-key. This ui-key is the product's LOGICAL workspace
  //    id (`repo-root:<repoRootId>:<branch>` for a "Work locally" launch), NOT
  //    the runtime's materialized workspace id — the two are distinct handles.
  await p.locator("[data-workspace-shell]").first().waitFor({ state: "visible", timeout: 30_000 });
  await p
    .locator('[data-workspace-shell][data-pending-workspace="false"]')
    .first()
    .waitFor({ state: "attached", timeout: WORKSPACE_SETTLE_TIMEOUT_MS });
  const logicalWorkspaceId = await readWorkspaceUiKey(p);

  // Map the logical ui-key to the runtime's MATERIALIZED workspace id (the id the
  // runtime records on sessions and returns from getSession). All runtime
  // correlation keys off the materialized id; the logical id is kept only for
  // the product-native DOM reload match (the DOM re-renders the logical ui-key).
  setStep("resolve materialized workspace id");
  const materializedWorkspaceId = await resolveMaterializedWorkspaceId(world, logicalWorkspaceId, WORKSPACE_SETTLE_TIMEOUT_MS);

  // Resolve the stable AnyHarness native session id from the runtime (the DOM's
  // data-workspace-session-id is the client's ephemeral, reload-regenerated id).
  setStep("resolve runtime session id");
  const sessionId = await resolveAnyharnessSessionId(world, materializedWorkspaceId, WORKSPACE_SETTLE_TIMEOUT_MS);

  // Turn completion is authoritative from AnyHarness's event stream (not
  // DOM-timing-flaky); a session-level error is a real failure, not a hang.
  setStep("wait for turn completion");
  const completion = await waitForTurnCompletion(world, sessionId, TURN_TIMEOUT_MS);
  if (completion.error) {
    if (process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR) {
      console.error(`[SH-BASE-TURN raw diag] model="${modelId}" turn error: ${completion.error}`);
    }
    throw new Error(`assistant turn errored: ${completion.error}`);
  }
  if (!completion.ended) {
    throw new Error(`assistant turn did not end within ${TURN_TIMEOUT_MS}ms`);
  }

  setStep("read assistant reply");
  const reply = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
  return { workspaceId: materializedWorkspaceId, logicalWorkspaceId, sessionId, reply };
}

/**
 * SHR-004a product-native reopen: reload the SAME renderer page with NO
 * localStorage preset. The product persisted its own workspace selection when
 * the driver created/opened the workspace through the UI, so a plain reload
 * must restore the SAME workspace's shell (the exact mechanism
 * `local-world-smoke-1.ts`'s `reopenAndVerify` relies on). If the product FAILS
 * to restore the workspace, the cell fails with a bounded message describing
 * exactly what the post-reload DOM showed (login screen / list without the
 * workspace / empty shell) — a real, diagnosable product finding.
 */
async function reloadTranscriptProductNative(
  _world: ReadySelfHostWorld,
  page: ProductPage,
  workspaceId: string,
): Promise<{ ok: true; text: string } | { ok: false; diagnostic: string }> {
  const p = page.page;
  await p.reload({ waitUntil: "domcontentloaded" });
  const shell = p.locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(workspaceId)}"]`).first();
  try {
    await shell.waitFor({ state: "attached", timeout: RELOAD_SHELL_TIMEOUT_MS });
  } catch {
    return { ok: false, diagnostic: await describePostReloadDom(p, workspaceId) };
  }
  const settled = p.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
  await settled.waitFor({ state: "attached", timeout: ASSISTANT_REPLY_TIMEOUT_MS }).catch(() => undefined);
  const text = await readAssistantReply(p, ASSISTANT_REPLY_TIMEOUT_MS);
  if (!text.trim()) {
    return {
      ok: false,
      diagnostic: `the workspace shell restored after reload but its transcript rendered no assistant reply for workspace "${workspaceId.slice(0, 8)}…"`,
    };
  }
  return { ok: true, text: text.trim() };
}

/**
 * Bounded, secret-free description of what a failed post-reload restore showed,
 * so a real product finding is diagnosable from the persisted red without a live
 * browser. Distinguishes a login screen, a mismatched/empty shell, and a
 * home/list view that never re-opened the workspace.
 */
async function describePostReloadDom(p: Page, workspaceId: string): Promise<string> {
  const short = workspaceId.slice(0, 8);
  const loginCount = await p.getByRole("button", { name: "Sign in", exact: true }).count().catch(() => 0);
  if (loginCount > 0) {
    return `the reload landed on the login screen (no authenticated session was restored) — expected workspace "${short}…"`;
  }
  const shellCount = await p.locator("[data-workspace-shell]").count().catch(() => 0);
  if (shellCount > 0) {
    const keys = await p
      .locator("[data-workspace-shell]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-workspace-ui-key")))
      .catch(() => [] as Array<string | null>);
    return `a workspace shell mounted but none matched workspace "${short}…" (shell ui-keys: ${JSON.stringify(keys)})`;
  }
  const homeCount = await p.locator("[data-home-composer-editor]").count().catch(() => 0);
  if (homeCount > 0) {
    return `the reload landed on the home/list view without re-opening workspace "${short}…"`;
  }
  return `the post-reload DOM showed neither a workspace shell, the home composer, nor a login screen (expected workspace "${short}…")`;
}

/**
 * Registers a run-scoped local repo-root under `runDir` in the controller-local
 * AnyHarness. AnyHarness resolves a repo-root only for a real git repository
 * (`ResolveRepoRootError::NotGitRepo`), so the dir is `git init`'d with one
 * empty baseline commit before the resolve call. Reuses `preparedRepository`'s
 * exported transport (`POST /v1/repo-roots/resolve`) so the wire shape stays
 * single-sourced. Returns the absolute repo-root path (the composer lists it
 * under `data-repo-source-root`).
 */
async function prepareLocalRepoRoot(world: ReadySelfHostWorld, workspaceDirName: string): Promise<string> {
  const repoPath = path.join(world.paths.runDir, workspaceDirName);
  mkdirSync(repoPath, { recursive: true });
  await runGit(["init"], repoPath);
  // A minimal, deterministic baseline so the repo-root resolves cleanly (no
  // network clone; committer identity is set inline so it never depends on
  // ambient git config).
  await runGit(
    ["-c", "user.email=selfhost-qual@proliferate.test", "-c", "user.name=Selfhost Qual", "commit", "--allow-empty", "-m", "baseline"],
    repoPath,
  );
  await defaultPreparedRepositoryTransport.resolveRepoRoot(world.runtime.baseUrl, repoPath);
  return repoPath;
}

/** Runs `git <args>` in `cwd`, rejecting with stderr on a non-zero exit. */
function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} (cwd=${cwd}) failed (${code}): ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Selects `modelId` in the home composer's model picker and asserts the picker
 * reflects it (mirrors LOCAL-WORLD-SMOKE-1's `selectModelInUi`). The picker is
 * disabled until agents are healthy and the just-installed claude agent can
 * surface a beat after AnyHarness reports it ready, so opening is retried.
 */
async function selectModelInComposer(p: Page, modelId: string): Promise<void> {
  const deadline = Date.now() + MODEL_PICKER_TIMEOUT_MS;
  const optionSelector = `[data-model-option="${cssAttr(modelId)}"]`;
  let lastAvailable: Array<string | null> = [];
  while (Date.now() < deadline) {
    const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
    try {
      await trigger.waitFor({ state: "visible", timeout: 5_000 });
      await trigger.click();
    } catch {
      await sleep(1_500);
      continue;
    }
    const option = p.locator(optionSelector).first();
    if (await option.count().catch(() => 0)) {
      await option.click();
      await p
        .locator(`[data-composer-model-trigger][data-composer-selected-model="${cssAttr(modelId)}"]`)
        .first()
        .waitFor({ state: "attached", timeout: 10_000 });
      return;
    }
    lastAvailable = await p
      .locator("[data-model-option]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-model-option")))
      .catch(() => []);
    await p.keyboard.press("Escape").catch(() => undefined);
    await sleep(2_000);
  }
  throw new Error(
    `selectModelInComposer: model "${modelId}" was not offered by the composer picker within ` +
      `${MODEL_PICKER_TIMEOUT_MS}ms. Last available options: ${JSON.stringify(lastAvailable)}.`,
  );
}

/** Clicks a role=button trigger whose accessible name matches `name`. */
async function clickByRole(p: Page, role: "button", name: RegExp, what: string): Promise<void> {
  const locator = p.getByRole(role, { name }).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (role=${role}, name=${name}): ${describe(error)}`);
  }
  await locator.click();
}

/** Clicks a popover menu row by its visible text (menu rows are native buttons). */
async function clickMenuItemByText(p: Page, text: string, what: string): Promise<void> {
  const byRole = p.getByRole("button", { name: text, exact: false }).first();
  if (await byRole.count().catch(() => 0)) {
    await byRole.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.click();
      return;
    }
  }
  const byText = p.getByText(text, { exact: false }).first();
  try {
    await byText.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (text="${text}"): ${describe(error)}`);
  }
  await byText.click();
}

/** Reads the settled workspace ui-key off the workspace shell (retried briefly). */
async function readWorkspaceUiKey(p: Page): Promise<string> {
  const shell = p.locator("[data-workspace-shell]").first();
  const deadline = Date.now() + 30_000;
  let workspaceId = "";
  while (Date.now() < deadline) {
    workspaceId = (await shell.getAttribute("data-workspace-ui-key").catch(() => "")) ?? "";
    if (workspaceId) {
      return workspaceId;
    }
    await sleep(500);
  }
  throw new Error(`readWorkspaceUiKey: workspace ui-key never settled (workspace="${workspaceId}").`);
}

/**
 * Maps the product's LOGICAL workspace ui-key to the runtime's MATERIALIZED
 * workspace id. The DOM `data-workspace-ui-key` for a "Work locally" launch is
 * the logical key `repo-root:<repoRootId>:<branch>` (URL-encoded segments); the
 * runtime records the materialized workspace id (a bare UUID) on its sessions
 * and workspaces. This bridges them by matching the runtime workspace whose
 * `repoRootId` equals the logical key's repoRootId. If the ui-key is already a
 * bare materialized id (defensive: some launch kinds render the materialized id
 * directly), a direct id match is accepted.
 *
 * `repoRootId` alone is the reliable key: this cell materializes exactly one
 * workspace on a fresh controller-local runtime, so the repoRootId is
 * unambiguous. Branch is only a best-effort tiebreaker when more than one
 * workspace shares the repoRootId — it is NEVER allowed to cause a false
 * non-match, because the logical id's branch segment comes from the product's
 * `workspaceBranchKey` (which prefers `originalBranch` and treats a detached
 * `"HEAD"` as absent) and can diverge from the runtime's `currentBranch`.
 */
async function resolveMaterializedWorkspaceId(
  world: ReadySelfHostWorld,
  logicalWorkspaceId: string,
  timeoutMs: number,
): Promise<string> {
  const parsed = parseRepoRootLogicalWorkspaceId(logicalWorkspaceId);
  const deadline = Date.now() + timeoutMs;
  let lastSeen: Array<{ id: string; repoRootId: string; branch?: string | null }> = [];
  while (Date.now() < deadline) {
    const workspaces = await world.runtime.client.listWorkspaces().catch(() => []);
    lastSeen = workspaces.map((w) => ({ id: w.id, repoRootId: w.repoRootId, branch: w.currentBranch }));
    // Direct materialized-id match (ui-key already a bare workspace id).
    const direct = workspaces.find((w) => w.id === logicalWorkspaceId);
    if (direct) {
      return direct.id;
    }
    if (parsed) {
      const byRepoRoot = workspaces.filter((w) => w.repoRootId === parsed.repoRootId);
      if (byRepoRoot.length === 1) {
        return byRepoRoot[0]!.id;
      }
      if (byRepoRoot.length > 1) {
        // Ambiguous only when the runtime holds several workspaces for the same
        // repo-root; prefer an exact branch match, else the most recent.
        const byBranch = byRepoRoot.find((w) => normalizeBranch(w.currentBranch) === parsed.branch);
        return (byBranch ?? byRepoRoot[byRepoRoot.length - 1]!).id;
      }
    }
    await sleep(1_000);
  }
  throw new Error(
    `resolveMaterializedWorkspaceId: no runtime workspace matched logical ui-key "${logicalWorkspaceId}" within ${timeoutMs}ms ` +
      `(runtime workspaces observed: ${JSON.stringify(lastSeen)}).`,
  );
}

/**
 * Parses a `repo-root:<repoRootId>:<branch>` logical workspace id (the format
 * the product's `buildRepoRootLogicalWorkspaceId` emits — URL-encoded segments,
 * mirrored here so the test harness stays free of a product-client import).
 * Returns null for any other logical-id kind (remote/path/local-slot) or a
 * malformed key.
 */
export function parseRepoRootLogicalWorkspaceId(
  logicalWorkspaceId: string,
): { repoRootId: string; branch: string } | null {
  const [kind, ...encoded] = logicalWorkspaceId.split(":");
  if (kind !== "repo-root" || encoded.length !== 2) {
    return null;
  }
  try {
    return { repoRootId: decodeURIComponent(encoded[0]!), branch: normalizeBranch(decodeURIComponent(encoded[1]!)) };
  } catch {
    return null;
  }
}

/** The branch key the logical id uses: an empty/absent branch normalizes to "HEAD". */
function normalizeBranch(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "HEAD";
}

/**
 * Resolves the AnyHarness native session id for a just-materialized local
 * workspace by polling the runtime's session list (the workspace holds exactly
 * this turn's session). This is the stable, correlatable identity — unlike the
 * Desktop client's ephemeral, reload-regenerated `data-workspace-session-id`.
 * `workspaceId` here is the MATERIALIZED runtime id (see
 * `resolveMaterializedWorkspaceId`), not the logical ui-key.
 */
async function resolveAnyharnessSessionId(world: ReadySelfHostWorld, workspaceId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastSeenWorkspaceIds: string[] = [];
  while (Date.now() < deadline) {
    const sessions = await world.runtime.client.listSessions().catch(() => []);
    lastSeenWorkspaceIds = sessions.map((session) => session.workspaceId);
    const forWorkspace = sessions.filter((session) => session.workspaceId === workspaceId);
    if (forWorkspace.length > 0) {
      return forWorkspace[forWorkspace.length - 1]!.id;
    }
    await sleep(1_000);
  }
  // Bounded, secret-free diagnostic: the observed session workspaceIds reveal
  // whether the runtime saw NO session at all (empty → the turn ran on a
  // different runtime than world.runtime) or a workspaceId FORMAT mismatch
  // (non-empty but no exact match). Ids are opaque handles, not secrets.
  throw new Error(
    `resolveAnyharnessSessionId: no AnyHarness session for workspace "${workspaceId}" within ${timeoutMs}ms ` +
      `(runtime session workspaceIds observed: ${JSON.stringify(lastSeenWorkspaceIds)}).`,
  );
}

/**
 * Waits for a non-streaming assistant prose block to carry non-empty text and
 * returns the last one's trimmed content (the final assistant answer).
 */
async function readAssistantReply(p: Page, timeoutMs: number): Promise<string> {
  const settled = p.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
  await settled.waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await settled.textContent().catch(() => "")) ?? "";
    if (text.trim().length > 0) {
      return text.trim();
    }
    await sleep(500);
  }
  return "";
}

/**
 * Picks the cheapest eligible non-premium model for the BYOK turn from the
 * controller-local runtime's launch options.
 *
 * NOT `models[0]`: the catalog's first anthropic-api entry is the synthetic
 * "default" sentinel ("use the default model") — it is not a directly launchable
 * provider model, so a BYOK-DIRECT turn forwards the literal id "default" to
 * Anthropic, which 404s (`not_found_error`, `model: default`). The gateway path
 * hides this because LiteLLM resolves it; BYOK-direct has no such layer. Prefer
 * the cheapest real tier the harness resolves (haiku, then sonnet — the latter
 * is the anthropic-api curation default, so it is guaranteed launchable), then
 * any remaining real model, skipping the "default" sentinel and costly [1m]
 * long-context variants.
 *
 * Exported (export-only, no behavior change) so the SELFHOST-QUAL-1 `SH-GATEWAY`
 * cell picks the same cheapest-eligible non-premium claude model for its one
 * gateway-routed turn (the "default" sentinel is launchable through the gateway,
 * but the cheapest real tier keeps the turn cheap either way).
 */
export async function resolveBaseTurnModel(world: ReadySelfHostWorld): Promise<string | undefined> {
  const options = await world.runtime.client.getAgentLaunchOptions();
  const entry = options.find((agent) => agent.kind === REPRESENTATIVE_HARNESS);
  const ids = (entry?.models ?? []).map((model) => model.id);
  const isSentinel = (id: string) => id === "default";
  for (const preferred of ["haiku", "sonnet"]) {
    if (ids.includes(preferred)) {
      return preferred;
    }
  }
  return (
    ids.find((id) => !isSentinel(id) && !id.includes("[1m]") && !/opus|fable/i.test(id)) ??
    ids.find((id) => !isSentinel(id)) ??
    ids[0]
  );
}

/**
 * Polls AnyHarness's session event stream until the turn ends or errors.
 * Exported (export-only, no behavior change) so the SELFHOST-QUAL-1 `SH-GATEWAY`
 * cell drives its one gateway-routed turn to completion with the identical
 * bounded machinery.
 */
export async function waitForTurnCompletion(
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

/**
 * Secret-free diagnostic of the controller-local runtime's agent-auth state file
 * (`<runtime_home>/agent-auth/state.json`) for a `waitForDesktopByokSync`
 * timeout: reports whether the Desktop push landed and, if so, the harness's
 * source KINDS + env-var names — never the raw provider key value. Distinguishes
 * "Desktop never pushed" (Layer A) from "pushed but models did not unlock"
 * (Layer B) without a live box.
 */
function summarizeRuntimeAuthState(runtimeHome: string, harnessKind: string): string {
  const statePath = path.join(runtimeHome, "agent-auth", "state.json");
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    return `[diag: runtime agent-auth/state.json absent — Desktop never pushed BYOK state (Layer A)]`;
  }
  try {
    const parsed = JSON.parse(raw) as {
      harnesses?: Array<{ harness_kind?: string; sources?: Array<{ kind?: string; env_var_name?: string }> }>;
    };
    const entry = parsed.harnesses?.find((h) => h.harness_kind === harnessKind);
    if (!entry) {
      return `[diag: state.json present but no "${harnessKind}" entry — Desktop push missing this harness (Layer A)]`;
    }
    const sources = (entry.sources ?? [])
      .map((s) => (s.env_var_name ? `${s.kind}(${s.env_var_name})` : String(s.kind)))
      .join(",");
    return `[diag: state.json "${harnessKind}" sources=[${sources}] — push landed; models did not unlock (Layer B)]`;
  } catch {
    return `[diag: runtime agent-auth/state.json unparseable]`;
  }
}

/**
 * SHR-004b: reads the controller-local runtime's agent-auth state file (the
 * same file `summarizeRuntimeAuthState` diagnoses) and returns the harness's
 * source `kind`s. `"api_key"`/`"gateway"` are AnyHarness's own route-auth
 * profile constants (`anyharness/crates/anyharness-lib/src/domains/agents/
 * route_auth/state.rs` `SOURCE_KIND_API_KEY`/`SOURCE_KIND_GATEWAY`) — a
 * BYOK-direct turn's pushed state must show only `"api_key"`, never
 * `"gateway"` (the LiteLLM virtual-key route). Returns `[]` if the state file
 * is absent/unparseable/missing the harness (the caller's `includes("api_key")`
 * check then fails closed rather than vacuously passing).
 */
function readRuntimeAuthSourceKinds(runtimeHome: string, harnessKind: string): string[] {
  const statePath = path.join(runtimeHome, "agent-auth", "state.json");
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as {
      harnesses?: Array<{ harness_kind?: string; sources?: Array<{ kind?: string }> }>;
    };
    const entry = parsed.harnesses?.find((h) => h.harness_kind === harnessKind);
    return (entry?.sources ?? []).map((source) => source.kind ?? "").filter((kind) => kind.length > 0);
  } catch {
    return [];
  }
}

/** The `/meta` capability fields SHR-004b/c observe (`server/proliferate/server/meta.py` `ServerCapabilities`). */
interface SelfHostMetaCapabilities {
  cloudWorkspaces: boolean;
  agentGateway: boolean;
}

/**
 * SHR-004b/c: reads the public `/meta` capability contract the SH-DESKTOP-OWNER
 * cell already trusts pre-login (bare `fetch`, no bearer needed) so
 * `no_litellm_spend`/`no_e2b` are backed by the server's own OBSERVED
 * advertisement rather than merely "we never called those paths."
 */
async function fetchServerCapabilities(world: ReadySelfHostWorld): Promise<SelfHostMetaCapabilities> {
  const response = await fetch(`${world.api.baseUrl}/meta`);
  if (!response.ok) {
    throw new Error(`fetchServerCapabilities: GET /meta failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { capabilities?: Partial<SelfHostMetaCapabilities> };
  const capabilities = body.capabilities;
  if (
    !capabilities ||
    typeof capabilities.cloudWorkspaces !== "boolean" ||
    typeof capabilities.agentGateway !== "boolean"
  ) {
    throw new Error(
      "fetchServerCapabilities: /meta response did not carry a capabilities.cloudWorkspaces/agentGateway boolean pair.",
    );
  }
  return { cloudWorkspaces: capabilities.cloudWorkspaces, agentGateway: capabilities.agentGateway };
}
