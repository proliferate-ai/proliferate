import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import type {
  CellEvidenceV1,
  SelfHostGatewayEvidenceV1,
  SelfHostGithubAuthEvidenceV1,
} from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import { constructSelfHostWorld } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";
import { runShippedInstaller, waitForHealth } from "../worlds/selfhost/install.js";
import {
  correlateGatewaySpend,
  resolveGatewayConfig,
  type GatewayEnvBlock,
  type GatewayEnvSource,
  type LitellmSpendRow,
} from "../worlds/selfhost/gateway.js";
// Imported READ-ONLY from the sibling install scenario (env/world-input resolver
// + CORS-origin helper) so both self-host scenarios resolve identically, PLUS
// the export-only turn machinery SH-BASE-TURN proves (authenticated renderer,
// cheapest-model pick, bounded turn-completion poll) reused verbatim by the
// SH-GATEWAY cell's gateway-routed turn.
import {
  browserOriginsForBox,
  openAuthenticatedPage,
  resolveBaseTurnModel,
  resolveSelfHostWorldInputs,
  waitForTurnCompletion,
  type SelfHostWorldConstructionInputs,
} from "./selfhost-install-1.js";
import {
  claimSelfHostOwner,
  inviteAndRegisterMemberViaApi,
  type SelfHostOwnerActor,
} from "../fixtures/selfhost-actor.js";
import { DEFAULT_BYOK_ENV_VAR, waitForDesktopByokSync } from "../fixtures/byok.js";
import {
  defaultGithubAuthOps,
  resolveGithubOauthConfig,
  type GithubAuthOps,
  type GithubOauthConfig,
} from "../fixtures/selfhost-github-auth.js";
import {
  configureAndEnableGatewayProfile,
  observeLitellmImageDigest,
  assertGatewayHealthyOnBox,
  litellmResolveActorKeyToken,
  litellmSpendRows,
  selectGatewayRouteForHarness,
  spendWindowUtc,
  waitForActorEnrollmentSynced,
} from "../worlds/selfhost/gateway.js";

/**
 * SELFHOST-QUAL-1 (frozen tier-3 contract §`SH-GITHUB-AUTH` + §`SH-GATEWAY`).
 * ONE matrix scenario, ONE shared self-host world (one EC2 install), lane
 * `selfhost`, harness `claude`, with two staged journey-cells run IN ORDER:
 * `SH-GITHUB-AUTH` then `SH-GATEWAY`. The canonical cell names are carried as
 * the `cell` dimension, giving ids like
 * `SELFHOST-QUAL-1/selfhost/cell=SH-GATEWAY,harness=claude`.
 *
 * ── ORIGIN MODE (derived from cell selection) ──────────────────────────────
 * SH-GITHUB-AUTH needs a FIXED public origin because its GitHub OAuth
 * application has a single registered callback URL; SH-GATEWAY is
 * origin-agnostic and must be runnable ALONE on a normal run-scoped origin (so
 * the gateway cell is live-provable before the OAuth app exists). The world is
 * therefore constructed on the FIXED serial-lane origin
 * (`selfhost-fixed.qualification.proliferate.com`) IFF SH-GITHUB-AUTH is among
 * the selected cells; when only SH-GATEWAY is selected the world uses the
 * ordinary run-scoped origin.
 *
 * The owner is claimed once (password-only `/setup`) as a shared prerequisite —
 * with identity A's verified GitHub email when SH-GITHUB-AUTH is selected and
 * its OAuth env resolves, so A's later GitHub sign-in links to that owner. A
 * failed install/claim fails both cells with a bounded prerequisite reason; the
 * world still closes exactly once and stamps the shared cleanup block into every
 * cell's evidence (a non-clean teardown downgrades any green cell).
 *
 * Unit tests are OFFLINE: they inject fake drivers/ops so no real
 * AWS/SSH/docker/network/anthropic/github is touched.
 */

export const SELFHOST_QUAL_1_ID = "SELFHOST-QUAL-1";
export const REPRESENTATIVE_HARNESS = "claude";

export const SH_GITHUB_AUTH = "SH-GITHUB-AUTH";
export const SH_GATEWAY = "SH-GATEWAY";
/** Run order: GitHub auth first (needs the fixed origin), then the gateway. */
export const SELFHOST_QUAL_CELL_ORDER = [SH_GITHUB_AUTH, SH_GATEWAY] as const;
export type SelfHostQualCellName = (typeof SELFHOST_QUAL_CELL_ORDER)[number];

/** The fixed serial-lane DNS label the SH-GITHUB-AUTH OAuth callback is registered against. */
export const FIXED_SUBDOMAIN_LABEL = "selfhost-fixed";

/** Bounded prompt for the SH-GATEWAY cell's one gateway-routed turn. */
export const GATEWAY_TURN_PROMPT = "Reply with exactly the word: pong";
const RESTART_HEALTH_TIMEOUT_MS = 180_000;
/** Bounded ceiling for the one gateway-routed turn (mirrors SH-BASE-TURN's turn budget). */
const GATEWAY_TURN_TIMEOUT_MS = 300_000;

/**
 * The world-level env the shared self-host world needs (AWS/SSH provisioning
 * inputs + the BYOK-A key the shared owner claim / gateway upstream can use).
 * Per-cell secrets (GitHub OAuth, LiteLLM image tag, gateway upstream) are NOT
 * scenario-level requiredEnv — each cell resolves and FAILS CLOSED on its own
 * missing inputs so SH-GATEWAY stays runnable when the OAuth app is absent.
 */
export const SELFHOST_QUAL_REQUIRED_ENV = [
  "RELEASE_E2E_SELFHOST_REGION",
  "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID",
  "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
  "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
] as const;

export const selfhostQual1: ScenarioDefinition = {
  id: SELFHOST_QUAL_1_ID,
  kind: "matrix",
  title:
    "prove the two optional self-host capabilities on one real install: configured GitHub OAuth " +
    "(SH-GITHUB-AUTH) and the operator LiteLLM gateway profile (SH-GATEWAY)",
  registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#sh-gateway",
  lanes: ["selfhost"],
  requiredEnv: SELFHOST_QUAL_REQUIRED_ENV,
  expandCells: (): ScenarioCellSpec[] =>
    SELFHOST_QUAL_CELL_ORDER.map((cell) => ({ dimensions: { cell, harness: REPRESENTATIVE_HARNESS } })),
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => planForCell(cell),
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runSelfHostQualCells(ctx, cells, defaultSelfHostQualDriver),
};

function planForCell(cell: PlannedCellV1): ScenarioPlanStep[] {
  const name = cell.dimensions.cell ?? "";
  const prefix = `[${cell.cell_id}]`;
  switch (name) {
    case SH_GITHUB_AUTH:
      return [
        { description: `${prefix} preflight the GitHub OAuth env (client id/secret + identity A/B state+email); fail closed if absent` },
        { description: `${prefix} owner already claimed password-only with identity A's verified GitHub email` },
        { description: `${prefix} configure GITHUB_OAUTH_CLIENT_ID/SECRET on the instance; /auth/desktop/methods advertises github only after` },
        { description: `${prefix} identity B signs in UNINVITED first and is denied` },
        { description: `${prefix} invite B through the product UI; B signs in via GitHub and is admitted with the invited role` },
        { description: `${prefix} identity A signs in via GitHub and links to the existing owner (no duplicate user)` },
      ];
    case SH_GATEWAY:
      return [
        { description: `${prefix} assert capabilities.agentGateway is FALSE before enabling the profile` },
        { description: `${prefix} write the run-scoped gateway env block (generated master key, pinned image tag, upstream key) over SSH; bootstrap --wait` },
        { description: `${prefix} assert capabilities.agentGateway is TRUE after; observe the LiteLLM image digest` },
        { description: `${prefix} enroll a fresh actor; the server mints its scoped virtual key; complete one cheap gateway-routed turn` },
        { description: `${prefix} correlate spend to the actor's virtual key on the instance LiteLLM (master key not used)` },
        { description: `${prefix} restart the stack; re-assert capability truth + gateway health persist` },
      ];
    default:
      return [{ description: `${prefix} unknown self-host cell "${name}"` }];
  }
}

// ── Evidence (sans the shared cleanup block, stamped once after both cells) ──

export type SelfHostGithubAuthEvidenceNoCleanup = Omit<SelfHostGithubAuthEvidenceV1, "cleanup">;
export type SelfHostGatewayEvidenceNoCleanup = Omit<SelfHostGatewayEvidenceV1, "cleanup">;
export type QualCellEvidenceNoCleanup = SelfHostGithubAuthEvidenceNoCleanup | SelfHostGatewayEvidenceNoCleanup;

export interface SelfHostQualCellResult {
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  evidence?: QualCellEvidenceNoCleanup;
}

// ── Driver seam (production wiring vs offline fakes) ────────────────────────

export interface SelfHostQualDriver {
  buildWorld(inputs: SelfHostWorldConstructionInputs, fixedSubdomain?: string): Promise<ReadySelfHostWorld>;
  /** Install the shipped bundle + claim the owner (optionally with a fixed email). */
  installAndClaim(
    world: ReadySelfHostWorld,
    opts: { ownerEmail?: string },
  ): Promise<{ ok: true; owner: SelfHostOwnerActor } | { ok: false; reason: string }>;
  runGithubAuth(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    oauth: { ok: true; value: GithubOauthConfig } | { ok: false; reason: string },
  ): Promise<SelfHostQualCellResult>;
  runGateway(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    env: GatewayEnvSource,
  ): Promise<SelfHostQualCellResult>;
  closeWorld(world: ReadySelfHostWorld): Promise<SelfHostWorldCleanupEvidence>;
}

export const defaultSelfHostQualDriver: SelfHostQualDriver = {
  buildWorld: (inputs, fixedSubdomain) =>
    constructSelfHostWorld({
      run: inputs.run,
      map: inputs.map,
      runDir: inputs.runDir,
      ports: inputs.ports,
      aws: inputs.aws,
      ssh: inputs.ssh,
      fixedSubdomain,
    }),

  async installAndClaim(world, opts) {
    try {
      const { repo, tag } = splitCandidateImageRef(world.artifacts.serverImage);
      const receipt = await runShippedInstaller({
        box: world.control.box,
        ssh: world.control.ssh,
        serverImageArchive: world.artifacts.serverImage,
        bundle: world.artifacts.bundle,
        bundleSha256SumsPath: bundleSha256SumsPath(world.artifacts.bundle.path),
        siteAddress: hostOf(world.api.baseUrl),
        candidateImageRepo: repo,
        candidateImageTag: tag,
        corsAllowOrigins: browserOriginsForBox(world),
      });
      const candidateServerVersion = world.artifacts.serverImage.version;
      if (receipt.serverVersion !== candidateServerVersion) {
        return {
          ok: false,
          reason:
            `SELFHOST-QUAL-1 install: the running server advertises "${receipt.serverVersion}", ` +
            `but the candidate map pins "${candidateServerVersion}"; refusing to claim a mismatched build.`,
        };
      }
      const owner = await claimSelfHostOwner(world, opts.ownerEmail ? { email: opts.ownerEmail } : {});
      return { ok: true, owner };
    } catch (error) {
      return { ok: false, reason: `SELFHOST-QUAL-1 install/claim failed: ${describe(error)}` };
    }
  },

  runGithubAuth: (world, owner, oauth) =>
    runGithubAuthCell(world, owner, oauth, defaultGithubAuthOps(tmpFileIo())),

  runGateway: (world, owner, env) => runGatewayCell(world, owner, env, defaultGatewayCellOps),

  closeWorld: (world) => world.close(),
};

/**
 * Per-scenario orchestration, independent of the matrix plumbing so it is
 * directly unit-testable against a fake driver:
 *   1. resolve world-construction inputs (typed failure → both cells fail clean);
 *   2. decide the origin mode from the selected cells (SH-GITHUB-AUTH → fixed);
 *   3. best-effort resolve the GitHub OAuth env (used to pick the owner email
 *      and to fail SH-GITHUB-AUTH closed when absent);
 *   4. build ONE world, install + claim the owner once;
 *   5. run the two cells IN ORDER; a failed prerequisite fails both cleanly;
 *   6. close the world exactly once and stamp the shared cleanup block into
 *      every cell's evidence (downgrading a green cell if cleanup was dirty).
 */
export async function runSelfHostQualCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: SelfHostQualDriver,
): Promise<ScenarioCellOutcome[]> {
  const inputs = resolveSelfHostWorldInputs(ctx);
  if (!inputs.ok) {
    return cells.map((cell) => failedOutcome(cell.cell_id, inputs.reason));
  }

  const wantsGithub = cells.some((cell) => cell.dimensions.cell === SH_GITHUB_AUTH);
  const fixedSubdomain = wantsGithub ? FIXED_SUBDOMAIN_LABEL : undefined;
  const env: GatewayEnvSource = { get: (name) => ctx.env.get(name) };
  const oauth = resolveGithubOauthConfig(env);
  const ownerEmail = wantsGithub && oauth.ok ? oauth.value.identityA.email : undefined;

  let world: ReadySelfHostWorld;
  try {
    world = await driver.buildWorld(inputs.value, fixedSubdomain);
  } catch (error) {
    return cells.map((cell) => failedOutcome(cell.cell_id, `world construction failed: ${describe(error)}`));
  }

  const resultsByCellId = new Map<string, SelfHostQualCellResult>();
  const setup = await driver.installAndClaim(world, { ownerEmail }).catch(
    (error): { ok: false; reason: string } => ({ ok: false, reason: describe(error) }),
  );

  for (const cellName of SELFHOST_QUAL_CELL_ORDER) {
    const cell = cells.find((candidate) => candidate.dimensions.cell === cellName);
    if (!cell) {
      continue;
    }
    if (!setup.ok) {
      resultsByCellId.set(cell.cell_id, {
        status: "failed",
        reason: { code: "scenario_failure", message: `${cellName} did not run: ${setup.reason}` },
      });
      continue;
    }
    let result: SelfHostQualCellResult;
    try {
      result =
        cellName === SH_GITHUB_AUTH
          ? await driver.runGithubAuth(world, setup.owner, oauth)
          : await driver.runGateway(world, setup.owner, env);
    } catch (error) {
      result = { status: "failed", reason: { code: "scenario_failure", message: describe(error) } };
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
      return failedOutcome(cell.cell_id, `Self-host cell "${cell.cell_id}" produced no result.`);
    }
    if (!result.evidence) {
      return { cellId: cell.cell_id, status: result.status, reason: result.reason } satisfies ScenarioCellOutcome;
    }
    if (!cleanup) {
      return failedOutcome(cell.cell_id, `World cleanup threw before producing a summary: ${describe(closeError)}`);
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

// ── SH-GITHUB-AUTH cell logic (ops injected; decision logic is offline-tested) ──

export async function runGithubAuthCell(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  oauth: { ok: true; value: GithubOauthConfig } | { ok: false; reason: string },
  ops: GithubAuthOps,
): Promise<SelfHostQualCellResult> {
  // Preflight fail-closed: absent OAuth env is a real red, never a skip.
  if (!oauth.ok) {
    return { status: "failed", reason: { code: "scenario_failure", message: oauth.reason } };
  }
  const config = oauth.value;

  // github must NOT be advertised before configuration (only-after proof).
  const before = await ops.fetchAuthMethods(world);
  if (before.includes("github")) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GITHUB-AUTH: /auth/desktop/methods advertised github BEFORE OAuth was configured.",
      },
    };
  }

  await ops.configureOauth(world, { clientId: config.clientId, clientSecret: config.clientSecret });

  const after = await ops.fetchAuthMethods(world);
  if (!after.includes("github")) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GITHUB-AUTH: /auth/desktop/methods did not advertise github after configuration.",
      },
    };
  }

  // Identity B signs in UNINVITED first → must be denied.
  const uninvited = await ops.signInWithGithub(world, config.identityB);
  if (uninvited.admitted) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GITHUB-AUTH: an uninvited GitHub identity (B) was admitted; it must be denied.",
      },
    };
  }

  // Invite B through the product UI, then B's GitHub sign-in must be admitted.
  await ops.inviteThroughUi(world, owner, config.identityB.email);
  const invited = await ops.signInWithGithub(world, config.identityB);
  if (!invited.admitted || !invited.memberRole) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: `SH-GITHUB-AUTH: invited GitHub identity (B) was not admitted with a role (saw ${JSON.stringify(invited)}).`,
      },
    };
  }

  // Identity A's GitHub sign-in must LINK to the existing owner (no duplicate).
  const linked = await ops.signInWithGithub(world, config.identityA);
  if (!linked.admitted || linked.userId !== owner.userId) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message:
          "SH-GITHUB-AUTH: identity A's GitHub sign-in did not link to the existing owner " +
          `(expected owner user, saw ${JSON.stringify({ admitted: linked.admitted, matched: linked.userId === owner.userId })}).`,
      },
    };
  }

  const evidence: SelfHostGithubAuthEvidenceNoCleanup = {
    kind: "selfhost_github_auth",
    artifact_ids: artifactIds(world),
    server_version: world.artifacts.serverImage.version,
    anyharness_version: world.artifacts.anyharness.version,
    harness: "claude",
    api_origin: hostOf(world.api.baseUrl),
    controller_runtime_origin: hostOf(world.runtime.baseUrl),
    owner_user_id_hash: sha256Hex(owner.userId),
    org_id_hash: sha256Hex(owner.organizationId),
    github_identity_a_hash: sha256Hex(config.identityA.email),
    github_identity_b_hash: sha256Hex(config.identityB.email),
    setup_password_only: true,
    owner_link_no_duplicate: true,
    uninvited_denied: true,
    invited_admitted: true,
    member_role: invited.memberRole,
    methods_advertise_github: true,
  };
  return { status: "green", evidence };
}

// ── SH-GATEWAY cell logic (ops injected; decision logic is offline-tested) ──

export interface GatewayCellOps {
  fetchAgentGatewayCapability(world: ReadySelfHostWorld): Promise<{ agentGateway: boolean; cloudWorkspaces: boolean }>;
  configureAndEnableGateway(world: ReadySelfHostWorld, block: GatewayEnvBlock): Promise<void>;
  observeLitellmImageDigest(world: ReadySelfHostWorld): Promise<string>;
  /** Enroll a fresh actor (lazy virtual-key mint) and run one cheap gateway-routed turn. */
  enrollActorAndRunTurn(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
  ): Promise<{ actorUserId: string; virtualKeyTokenId: string; turn: { ended: boolean; error?: string; modelId: string } }>;
  /** Snapshot the instance LiteLLM per-request spend rows for correlation. */
  snapshotSpendRows(world: ReadySelfHostWorld): Promise<LitellmSpendRow[]>;
  /** Restart the stack and re-assert capability truth + gateway health persist. */
  restartAndReassert(world: ReadySelfHostWorld): Promise<{ capabilityStillTrue: boolean; healthy: boolean }>;
}

export async function runGatewayCell(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  env: GatewayEnvSource,
  ops: GatewayCellOps,
): Promise<SelfHostQualCellResult> {
  // capability_gateway_before MUST be literal false: the base install advertises
  // the gateway disabled. A true reading here is a capability mismatch.
  const before = await ops.fetchAgentGatewayCapability(world);
  if (before.agentGateway !== false) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GATEWAY: capabilities.agentGateway was already true before the profile was enabled (mismatch).",
      },
    };
  }

  const config = resolveGatewayConfig(env, world.api.baseUrl);
  if (!config.ok) {
    return { status: "failed", reason: { code: "scenario_failure", message: config.reason } };
  }

  await ops.configureAndEnableGateway(world, config.value.block);

  const after = await ops.fetchAgentGatewayCapability(world);
  if (after.agentGateway !== true) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GATEWAY: capabilities.agentGateway did not flip to true after enabling the profile (mismatch).",
      },
    };
  }

  const litellmImageDigest = await ops.observeLitellmImageDigest(world);
  const enrolled = await ops.enrollActorAndRunTurn(world, owner);
  if (enrolled.turn.error) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: `SH-GATEWAY: gateway-routed turn errored: ${enrolled.turn.error}` },
    };
  }
  if (!enrolled.turn.ended) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: "SH-GATEWAY: the gateway-routed turn did not end." },
    };
  }

  const rows = await ops.snapshotSpendRows(world);
  const correlation = correlateGatewaySpend(rows, enrolled.virtualKeyTokenId);
  if (!correlation.correlated) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-GATEWAY: no token-consuming spend correlated to the actor's virtual key on the instance LiteLLM.",
      },
    };
  }
  if (!correlation.masterKeyNotUsed) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message:
          "SH-GATEWAY: token-consuming spend rode a key other than the actor's virtual key — the turn did not go " +
          "through the actor's scoped virtual key (a direct master-key call is not product proof).",
      },
    };
  }

  const restart = await ops.restartAndReassert(world);
  if (!restart.capabilityStillTrue || !restart.healthy) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: `SH-GATEWAY: gateway did not persist across restart (capabilityStillTrue=${restart.capabilityStillTrue}, healthy=${restart.healthy}).`,
      },
    };
  }

  const evidence: SelfHostGatewayEvidenceNoCleanup = {
    kind: "selfhost_gateway",
    artifact_ids: artifactIds(world),
    server_version: world.artifacts.serverImage.version,
    anyharness_version: world.artifacts.anyharness.version,
    harness: "claude",
    api_origin: hostOf(world.api.baseUrl),
    controller_runtime_origin: hostOf(world.runtime.baseUrl),
    actor_user_id_hash: sha256Hex(enrolled.actorUserId),
    virtual_key_id_hash: sha256Hex(enrolled.virtualKeyTokenId),
    litellm_image_digest: litellmImageDigest,
    model_id: enrolled.turn.modelId,
    capability_gateway_before: false,
    capability_gateway_after: true,
    gateway_spend_correlated: true,
    master_key_not_used: true,
    restart_persisted: true,
  };
  return { status: "green", evidence };
}

// ── Default production ops (call real helpers; live proof is an open risk) ──

const defaultGatewayCellOps: GatewayCellOps = {
  async fetchAgentGatewayCapability(world) {
    return fetchAgentGatewayCapability(world.api.baseUrl);
  },
  async configureAndEnableGateway(world, block) {
    await configureAndEnableGatewayProfile(world.control.ssh, block, tmpFileIo());
  },
  async observeLitellmImageDigest(world) {
    return observeLitellmImageDigest(world.control.ssh);
  },
  async enrollActorAndRunTurn(world, owner) {
    return enrollActorAndRunGatewayTurn(world, owner);
  },
  async snapshotSpendRows(world) {
    return litellmSpendRows(world.control.ssh, spendWindowUtc());
  },
  async restartAndReassert(world) {
    await world.control.restartStack();
    await waitForHealth(world.api.baseUrl, { timeoutMs: RESTART_HEALTH_TIMEOUT_MS });
    const capability = await fetchAgentGatewayCapability(world.api.baseUrl);
    const health = await assertGatewayHealthyOnBox(world.control.ssh);
    return {
      capabilityStillTrue: capability.agentGateway === true,
      healthy: health.healthy && health.agentGatewayEnabled,
    };
  },
};

/**
 * The real product-path gateway turn (frozen tier-3 contract §`SH-GATEWAY`): a
 * FRESH actor is enrolled through the product, the MANAGED gateway route is
 * selected for claude, the Desktop pushes the rendered gateway source into the
 * controller-local candidate AnyHarness, and ONE cheap turn runs — routed, by
 * construction of the pushed source (public `/llm` URL + the actor's scoped
 * virtual key), through the INSTANCE LiteLLM (which `correlateGatewaySpend`
 * proves). Reuses SH-BASE-TURN's proven turn machinery verbatim; the only
 * differences from BYOK are the fresh-actor enrollment (the virtual key is
 * minted server-side at signup) and the `sourceKind:"gateway"` selection.
 *
 * Returns the identifiers the cell's correlation step needs: the actor's product
 * user id, its PERSONAL virtual-key token on the instance LiteLLM, and the
 * turn's outcome (ended/error + the model id). Any drive failure is reported as
 * a bounded `turn.error` (fail closed) rather than thrown, so the cell records a
 * clean red — never a false green.
 */
export async function enrollActorAndRunGatewayTurn(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
): Promise<{
  actorUserId: string;
  virtualKeyTokenId: string;
  turn: { ended: boolean; error?: string; modelId: string };
}> {
  // 1. Enroll a fresh actor through the product (invitation + register). The
  //    register/login fires the server's eager gateway enrollment
  //    (`ensure_user_enrollment` via `signup_hook`), which mints the actor's
  //    scoped LiteLLM virtual key server-side before the turn.
  const actor = await inviteAndRegisterMemberViaApi(world, owner);

  // 2. Select the MANAGED gateway route for claude on the LOCAL surface exactly
  //    the way the product does (`sourceKind:"gateway"`; no api_key material).
  await selectGatewayRouteForHarness(actor.api, REPRESENTATIVE_HARNESS);

  // 2b. Wait for the actor's server-side enrollment to reach `synced` (its
  //     virtual key minted) BEFORE the Desktop fetches state. On self-host a
  //     fresh member is enrolled by the backfill worker (not synchronously at
  //     register), so this bounds the wait for the key to exist — guaranteeing
  //     the Desktop's one `/state?surface=local` fetch renders a populated
  //     gateway source rather than pushing an empty one it never re-fetches.
  await waitForActorEnrollmentSynced(actor.api);

  // 3. Open the actor's authenticated renderer; the Desktop fetches
  //    `GET /state?surface=local` for THIS user and pushes the rendered gateway
  //    source ({kind:"gateway", base_url:<public /llm>, key:<virtual key>}) into
  //    the controller-local AnyHarness.
  const page = await openAuthenticatedPage(world, actor);
  try {
    // 4. Wait until the pushed gateway route makes claude launchable in the
    //    controller-local runtime (identical launchability/install-trigger wait
    //    SH-BASE-TURN uses; only the harness kind matters to it).
    await waitForDesktopByokSync(world, page, {
      apiKeyId: "gateway",
      harnessKind: REPRESENTATIVE_HARNESS,
      envVarName: DEFAULT_BYOK_ENV_VAR,
    });

    // 5. Cheapest eligible non-premium claude model (same picker as SH-BASE-TURN).
    const modelId = await resolveBaseTurnModel(world);
    if (!modelId) {
      return {
        actorUserId: actor.userId,
        virtualKeyTokenId: "",
        turn: {
          ended: false,
          error: "no launchable claude model was offered by the controller-local AnyHarness",
          modelId: "",
        },
      };
    }

    // 6. One bounded cheap turn through the controller-local runtime. Because the
    //    pushed source is the gateway route, the turn rides the INSTANCE LiteLLM.
    const workspacePath = path.join(world.paths.runDir, "selfhost-gateway-turn-workspace");
    mkdirSync(workspacePath, { recursive: true });
    const created = await world.runtime.client.createLocalWorkspace(workspacePath);
    const session = await world.runtime.client.createSession({
      workspaceId: created.workspace.id,
      agentKind: REPRESENTATIVE_HARNESS,
      modelId,
    });
    await world.runtime.client.prompt(session.id, GATEWAY_TURN_PROMPT);
    const completion = await waitForTurnCompletion(world, session.id, GATEWAY_TURN_TIMEOUT_MS);

    // 7. Resolve the actor's PERSONAL virtual-key token on the instance LiteLLM
    //    (the `api_key` its spend rows carry) — the key the gateway agent-auth
    //    state actually rendered, preferred over any co-located org-enrollment
    //    key. A resolution failure is a bounded fail-closed turn error.
    let virtualKeyTokenId = "";
    let tokenError: string | undefined;
    try {
      virtualKeyTokenId = await litellmResolveActorKeyToken(world.control.ssh, actor.userId);
    } catch (error) {
      tokenError = describe(error);
    }

    return {
      actorUserId: actor.userId,
      virtualKeyTokenId,
      turn: {
        ended: completion.ended,
        error: completion.error ?? tokenError,
        modelId,
      },
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ── Small shared helpers ────────────────────────────────────────────────────

/** A local 0600 tmp-file IO seam for scp'ing secret env blocks (never argv). */
export function tmpFileIo(): {
  writeLocalTmp: (contents: string) => Promise<string>;
  removeLocalTmp: (path: string) => Promise<void>;
} {
  return {
    async writeLocalTmp(contents) {
      const dir = await mkdtemp(path.join(tmpdir(), "selfhost-qual-"));
      const file = path.join(dir, "env-block");
      await writeFile(file, contents, { mode: 0o600 });
      return file;
    },
    async removeLocalTmp(file) {
      await rm(path.dirname(file), { recursive: true, force: true });
    },
  };
}

/** The `/meta` gateway/cloud capability booleans SH-GATEWAY reads pre/post enable. */
async function fetchAgentGatewayCapability(
  apiBaseUrl: string,
): Promise<{ agentGateway: boolean; cloudWorkspaces: boolean }> {
  const response = await fetch(`${apiBaseUrl}/meta`);
  if (!response.ok) {
    throw new Error(`SH-GATEWAY: GET /meta failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { capabilities?: { agentGateway?: unknown; cloudWorkspaces?: unknown } };
  const capabilities = body.capabilities;
  if (
    !capabilities ||
    typeof capabilities.agentGateway !== "boolean" ||
    typeof capabilities.cloudWorkspaces !== "boolean"
  ) {
    throw new Error("SH-GATEWAY: /meta did not carry a capabilities.agentGateway/cloudWorkspaces boolean pair.");
  }
  return { agentGateway: capabilities.agentGateway, cloudWorkspaces: capabilities.cloudWorkspaces };
}

export function attachCleanupEvidence(
  evidence: QualCellEvidenceNoCleanup,
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

function failedOutcome(cellId: string, message: string): ScenarioCellOutcome {
  return { cellId, status: "failed", reason: { code: "scenario_failure", message } };
}

/** Host (never the raw URL/credentials) evidence records for an origin. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? url;
  }
}

const CANDIDATE_SERVER_IMAGE_REPO = "proliferate-server-qualification";

/** Derives the docker `<repo>:<tag>` from the server artifact version (never stable/latest). */
function splitCandidateImageRef(serverImage: { version: string }): { repo: string; tag: string } {
  const value = serverImage.version;
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === value.length - 1) {
    return { repo: CANDIDATE_SERVER_IMAGE_REPO, tag: value };
  }
  return { repo: value.slice(0, lastColon), tag: value.slice(lastColon + 1) };
}

/** The bundle's adjacent `self-hosted-assets.SHA256SUMS` path (installer verifies it). */
function bundleSha256SumsPath(materializedBundlePath: string): string {
  return path.join(path.dirname(materializedBundlePath), "self-hosted-assets.SHA256SUMS");
}
