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
} from "../fixtures/byok.js";
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
 * observing their absence from the controller's own ambient env is part of the
 * "world was constructed with no LiteLLM env configured" half of
 * `no_litellm_spend`.
 */
const LITELLM_GATEWAY_ENV_VARS = [
  "RELEASE_E2E_GATEWAY_TEST_KEY",
  "AGENT_GATEWAY_LITELLM_BASE_URL",
  "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
  "AGENT_GATEWAY_LITELLM_MASTER_KEY",
] as const;
/**
 * SHR-004a: the raw-string key the browser-fallback `ProductStorage` persists
 * the selected LOGICAL workspace id under
 * (`apps/desktop/src/lib/access/browser/product-storage.ts` falls through to
 * `window.localStorage` outside Tauri; the key name itself is
 * `apps/packages/product-client/src/hooks/sessions/lifecycle/use-session-selection-lifecycle.ts`'s
 * `LOGICAL_WORKSPACE_SELECTION_KEY`). For a purely local (non-cloud) workspace
 * the logical id IS the physical AnyHarness workspace id (verified against
 * `data-workspace-ui-key={selectedLogicalWorkspaceId ?? selectedWorkspaceId ?? ""}`
 * in `StandardWorkspaceShell.tsx`, and against how `local-world-smoke-1.ts`'s
 * own natural "materialize via the UI, reload, and the shell comes back" reopen
 * already relies on this same persisted key). Presetting it before a reload —
 * exactly like `BROWSER_AUTH_SESSION_KEY` is preset elsewhere in this file — is
 * what makes a plain reload restore the SAME local workspace's shell.
 */
const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

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
      try {
        await waitForDesktopByokSync(world, page, selection);
      } catch (error) {
        // Enrich the timeout with whether the Desktop push actually landed in
        // the controller-local runtime home (Layer A vs Layer B): source kinds
        // + env-var names only, never the raw key value.
        const diag = summarizeRuntimeAuthState(world.paths.runtimeHome, selection.harnessKind);
        throw new Error(`${error instanceof Error ? error.message : String(error)} ${diag}`);
      }

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
        // Env-gated raw diagnostic (never on the green path; provider bodies are
        // redacted out of persisted evidence). Local diagnostic runs set
        // LOCAL_WORLD_SMOKE_DEBUG_DIR to see the unredacted provider error.
        if (process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR) {
          console.error(`[SH-BASE-TURN raw diag] model="${modelId}" turn error: ${completion.error}`);
        }
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
      // Reopen (API): the workspace/session must remain commandable from the
      // controller-local runtime after the turn.
      const reopened = await world.runtime.client.getSession(session.id);
      if (!reopened || reopened.workspaceId !== created.workspace.id) {
        return {
          status: "failed",
          reason: { code: "scenario_failure", message: "SH-BASE-TURN: session did not remain commandable after reopen." },
        };
      }

      // SHR-004a: `transcript_reopened` must be OBSERVED, not merely asserted
      // by construction — actually reload the renderer page/context and
      // re-read the SAME session's transcript DOM. This workspace/session were
      // created directly over the runtime API (never through the composer), so
      // nothing points the renderer at them yet; point it there the same way
      // the product itself restores a workspace on reload (see the helper doc).
      const reloadedTranscript = await reopenAndReadTranscriptInRenderer(page, created.workspace.id);
      if (!EXPECTED_TURN_REPLY_PATTERN.test(reloadedTranscript)) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message:
              `SH-BASE-TURN: the renderer's re-read transcript after a fresh page load did not contain the ` +
              `turn's reply (saw ${JSON.stringify(reloadedTranscript)}).`,
          },
        };
      }

      // SHR-004b/c: `no_litellm_spend`/`no_e2b` must be OBSERVED, not merely
      // asserted by construction.
      const capabilities = await fetchServerCapabilities(world);
      if (capabilities.agentGateway) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: "SH-BASE-TURN: /meta reports capabilities.agentGateway=true; expected the self-host instance to advertise it disabled.",
          },
        };
      }
      if (capabilities.cloudWorkspaces) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: "SH-BASE-TURN: /meta reports capabilities.cloudWorkspaces=true; expected the self-host instance to advertise it disabled.",
          },
        };
      }
      const gatewayEnvVar = LITELLM_GATEWAY_ENV_VARS.find((name) => process.env[name]?.trim());
      if (gatewayEnvVar) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-BASE-TURN: the world's controller env carries "${gatewayEnvVar}"; a BYOK-only self-host run must configure no LiteLLM gateway input.`,
          },
        };
      }
      const authSourceKinds = readRuntimeAuthSourceKinds(world.paths.runtimeHome, selection.harnessKind);
      if (!authSourceKinds.includes("api_key")) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-BASE-TURN: the pushed BYOK auth state for "${selection.harnessKind}" does not carry an "api_key" source (saw ${JSON.stringify(authSourceKinds)}).`,
          },
        };
      }
      if (authSourceKinds.includes("gateway")) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-BASE-TURN: the pushed BYOK auth state for "${selection.harnessKind}" carries a "gateway" (LiteLLM virtual-key) source; a BYOK-direct turn must show only "api_key" (saw ${JSON.stringify(authSourceKinds)}).`,
          },
        };
      }
      const scrubbedChildEnv = candidateChildEnvironment(process.env);
      const e2bEnvKey = Object.keys(scrubbedChildEnv).find((key) => /e2b/i.test(key));
      if (e2bEnvKey) {
        return {
          status: "failed",
          reason: {
            code: "scenario_failure",
            message: `SH-BASE-TURN: the world's scrubbed candidate child env carries an E2B key ("${e2bEnvKey}"); expected none.`,
          },
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

/**
 * SHR-004a: reloads the SAME renderer page/context and re-reads the
 * SH-BASE-TURN workspace's transcript DOM — a genuine fresh document load, not
 * a second call into AnyHarness's in-memory API. The workspace/session were
 * created directly over the runtime API (never through the composer), so
 * nothing points the renderer at them yet; presetting
 * `LOGICAL_WORKSPACE_SELECTION_KEY` (see its doc) before the reload is what
 * makes the restored shell resolve to THIS workspace, the same mechanism a
 * plain reload already relies on for a UI-materialized workspace. Returns the
 * settled assistant reply text (empty string if none rendered in time).
 */
async function reopenAndReadTranscriptInRenderer(page: ProductPage, workspaceId: string): Promise<string> {
  const p = page.page;
  await p.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    // ProductStorage decodes stored values with JSON.parse (decodeStoredJson),
    // so the id must be stored as a JSON string — a raw UUID fails to parse
    // and the selection silently falls back to none.
    { key: LOGICAL_WORKSPACE_SELECTION_KEY, value: JSON.stringify(workspaceId) },
  );
  await p.reload({ waitUntil: "domcontentloaded" });
  await p
    .locator(`[data-workspace-shell][data-workspace-ui-key="${cssAttr(workspaceId)}"]`)
    .first()
    .waitFor({ state: "attached", timeout: 60_000 });

  const settled = p.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
  await settled.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);
  const deadline = Date.now() + 30_000;
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
