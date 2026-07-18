import { createHash } from "node:crypto";
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
  SelfHostCloudAddonEvidenceV1,
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
  createLocalWorkspaceTurnThroughUi,
  openAuthenticatedPage,
  resolveBaseTurnModel,
  resolveSelfHostWorldInputs,
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
import {
  configureAndEnableCloudAddonProfile,
  disableCloudAddonProfile,
  resolveCloudAddonConfig,
  type CloudAddonConfig,
  type CloudAddonEnvSource,
} from "../worlds/selfhost/cloud-addon.js";
import { wakeCloudSandbox } from "../fixtures/cloud-sandbox.js";
import {
  killProviderSandbox,
  pauseProviderSandbox,
  readProviderSandboxFile,
  writeProviderSandboxFile,
} from "../fixtures/e2b-verify.js";

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
export const SH_CLOUD_ADDON = "SH-CLOUD-ADDON";
/**
 * Run order (frozen contract "World topology and staging"): GitHub auth first
 * (needs the fixed origin), then the gateway, then the cloud add-on last (it
 * needs the fixed-origin GitHub App callback + the E2B/self-built-template
 * founder inputs, implemented on the post-PR 2 rebase per decision 5).
 */
export const SELFHOST_QUAL_CELL_ORDER = [SH_GITHUB_AUTH, SH_GATEWAY, SH_CLOUD_ADDON] as const;
export type SelfHostQualCellName = (typeof SELFHOST_QUAL_CELL_ORDER)[number];

/**
 * The founder-gated live inputs each cell READS through `ctx.env.get` but does
 * not require to plan (PR7-CONTROL-004): declared as the cell's `optionalEnv` so
 * they are resolved into `ctx.env` when supplied (making the cell exercise its
 * real path) while their absence stays a fail-closed cell red — never a
 * runner-blocked cell, and SH-GATEWAY stays runnable without SH-GITHUB-AUTH's
 * OAuth app. Every name is manifest-declared. `RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY`
 * is scenario-level required already; the `_B_` upstream key is the gateway's
 * preferred (optional) separate-spend key.
 */
export const SELFHOST_QUAL_CELL_OPTIONAL_ENV: Record<SelfHostQualCellName, readonly string[]> = {
  [SH_GITHUB_AUTH]: [
    "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID",
    "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET",
    "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE",
    "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE",
    "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL",
    "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL",
  ],
  [SH_GATEWAY]: ["RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY", "RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG"],
  [SH_CLOUD_ADDON]: [
    "RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY",
    "RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME",
    "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID",
    "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID",
    "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET",
    "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY",
  ],
};

/** The fixed serial-lane DNS label the SH-GITHUB-AUTH OAuth callback is registered against. */
export const FIXED_SUBDOMAIN_LABEL = "selfhost-fixed";

/** Bounded prompt for the SH-GATEWAY cell's one gateway-routed turn. */
export const GATEWAY_TURN_PROMPT = "Reply with exactly the word: pong";

/**
 * The exact role SH-GITHUB-AUTH's invited identity B must be admitted with
 * (PR7-CONTROL-010): the invite is a member invite, so the green predicate
 * requires EXACTLY `member`, not any truthy role.
 */
export const EXPECTED_INVITED_ROLE = "member";
const RESTART_HEALTH_TIMEOUT_MS = 180_000;

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
  "RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64",
  "RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64",
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
    SELFHOST_QUAL_CELL_ORDER.map((cell) => ({
      dimensions: { cell, harness: REPRESENTATIVE_HARNESS },
      // Per-cell founder-gated live inputs are OPTIONAL env: resolved into
      // ctx.env when present so the cell exercises its real path, but absent →
      // the cell fails CLOSED (red) rather than being runner-blocked, and
      // SH-GATEWAY stays runnable without the SH-GITHUB-AUTH OAuth app
      // (PR7-CONTROL-004).
      optionalEnv: SELFHOST_QUAL_CELL_OPTIONAL_ENV[cell as SelfHostQualCellName],
    })),
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
    case SH_CLOUD_ADDON:
      return [
        { description: `${prefix} SCAFFOLDED (PR7-CONTROL-009): the enable/disable + capability-truth machinery and offline decision logic exist, but the production provisioning drive (instance-GitHub-App authorize → sandbox → turn → pause/wake) is NOT yet wired — the cell FAILS CLOSED until it is` },
        { description: `${prefix} preflight the cloud add-on env (E2B key/team/template + instance GitHub App); fail closed if absent` },
        { description: `${prefix} assert capabilities.cloudWorkspaces is FALSE before enabling the add-on` },
        { description: `${prefix} write the add-on env block (E2B pair + GitHub App) over SSH; bootstrap --wait; assert cloudWorkspaces TRUE` },
        { description: `${prefix} [not-yet-wired] authorize the instance GitHub App + provision one personal sandbox/workspace on the self-built template; compare the provisioned immutable template id to the configured one` },
        { description: `${prefix} [not-yet-wired] run one representative turn; register the provisioned E2B sandbox for durable reap` },
        { description: `${prefix} [not-yet-wired] pause then wake the sandbox; assert the TURN'S OWN workspace/session state (not an ad-hoc marker) survives intact` },
        { description: `${prefix} disable the add-on + reconverge; assert cloudWorkspaces drops to FALSE and the base product stays healthy` },
      ];
    default:
      return [{ description: `${prefix} unknown self-host cell "${name}"` }];
  }
}

// ── Evidence (sans the shared cleanup block, stamped once after both cells) ──

export type SelfHostGithubAuthEvidenceNoCleanup = Omit<SelfHostGithubAuthEvidenceV1, "cleanup">;
export type SelfHostGatewayEvidenceNoCleanup = Omit<SelfHostGatewayEvidenceV1, "cleanup">;
export type SelfHostCloudAddonEvidenceNoCleanup = Omit<SelfHostCloudAddonEvidenceV1, "cleanup">;
export type QualCellEvidenceNoCleanup =
  | SelfHostGithubAuthEvidenceNoCleanup
  | SelfHostGatewayEvidenceNoCleanup
  | SelfHostCloudAddonEvidenceNoCleanup;

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
  runCloudAddon(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    env: CloudAddonEnvSource,
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
      tls: inputs.tls,
    }),

  async installAndClaim(world, opts) {
    let receipt: Awaited<ReturnType<typeof runShippedInstaller>>;
    try {
      const { repo, tag } = splitCandidateImageRef(world.artifacts.serverImage);
      receipt = await runShippedInstaller({
        box: world.control.box,
        ssh: world.control.ssh,
        serverImageArchive: world.artifacts.serverImage,
        bundle: world.artifacts.bundle,
        bundleSha256SumsPath: bundleSha256SumsPath(world.artifacts.bundle.path),
        siteAddress: hostOf(world.api.baseUrl),
        candidateImageRepo: repo,
        candidateImageTag: tag,
        corsAllowOrigins: browserOriginsForBox(world),
        tlsCertificatePath: world.paths.tlsCertificatePath,
        tlsPrivateKeyPath: world.paths.tlsPrivateKeyPath,
      });
    } catch (error) {
      return { ok: false, reason: describeSelfHostSetupFailure("install", error) };
    }

    const candidateServerVersion = world.artifacts.serverImage.version;
    if (receipt.serverVersion !== candidateServerVersion) {
      return {
        ok: false,
        reason:
          `SELFHOST-QUAL-1 install: the running server advertises "${receipt.serverVersion}", ` +
          `but the candidate map pins "${candidateServerVersion}"; refusing to claim a mismatched build.`,
      };
    }

    try {
      const owner = await claimSelfHostOwner(world, opts.ownerEmail ? { email: opts.ownerEmail } : {});
      return { ok: true, owner };
    } catch (error) {
      return { ok: false, reason: describeSelfHostSetupFailure("owner_claim", error) };
    }
  },

  runGithubAuth: (world, owner, oauth) =>
    runGithubAuthCell(world, owner, oauth, defaultGithubAuthOps(tmpFileIo())),

  runGateway: (world, owner, env) => runGatewayCell(world, owner, env, defaultGatewayCellOps),

  runCloudAddon: (world, owner, env) => runCloudAddonCell(world, owner, env, defaultCloudAddonCellOps),

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
          : cellName === SH_GATEWAY
            ? await driver.runGateway(world, setup.owner, env)
            : await driver.runCloudAddon(world, setup.owner, env);
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

  // Invite B through the product UI, then B's GitHub sign-in must be admitted
  // with EXACTLY the invited role (`member`) — not merely any truthy role
  // (PR7-CONTROL-010). The invite is a member invite (decision 4 "correct
  // role"), so admitting B as owner/admin, or with an empty/unknown role, is a
  // failure, not a pass.
  await ops.inviteThroughUi(world, owner, config.identityB.email);
  const invited = await ops.signInWithGithub(world, config.identityB);
  if (!invited.admitted || invited.memberRole !== EXPECTED_INVITED_ROLE) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message:
          `SH-GITHUB-AUTH: invited GitHub identity (B) was not admitted as exactly "${EXPECTED_INVITED_ROLE}" ` +
          `(saw ${JSON.stringify({ admitted: invited.admitted, memberRole: invited.memberRole })}).`,
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

    // 6. One bounded cheap turn — created ENTIRELY through the real renderer
    //    composer against the controller-local runtime (the UI-real path
    //    SH-BASE-TURN proves, reused verbatim). Because the pushed source is the
    //    gateway route, the turn rides the INSTANCE LiteLLM. The helper throws
    //    (bounded) on a create/turn failure; catch it as a fail-closed turn error.
    let turnEnded = false;
    let turnError: string | undefined;
    try {
      await createLocalWorkspaceTurnThroughUi(world, page, modelId, GATEWAY_TURN_PROMPT, "selfhost-gateway-turn-workspace");
      turnEnded = true;
    } catch (error) {
      turnError = describe(error);
    }

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
        ended: turnEnded,
        error: turnError ?? tokenError,
        modelId,
      },
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ── SH-CLOUD-ADDON cell logic (ops injected; decision logic is offline-tested) ──

/**
 * What the production provisioning drive resolves once the add-on is enabled and
 * one personal sandbox/workspace has been materialized through the real product
 * GitHub-authorization path. All ids are RAW here (hashed into evidence by the
 * cell); `providerSandboxId` is the E2B provider id used to reap + pause/wake the
 * separate-account sandbox. `turn.error` (fail closed) rather than a throw keeps
 * a provisioning/turn failure a clean red — never a false green.
 */
export interface CloudAddonProvisionResult {
  githubAppInstallationId: string;
  e2bTemplateId: string;
  sandboxId: string;
  workspaceId: string;
  sessionId: string;
  /** The E2B provider sandbox id, for durable reap + pause/wake (empty if never created). */
  providerSandboxId: string;
  turn: { ended: boolean; error?: string };
}

export interface CloudAddonCellOps {
  /** Read `/meta` capability truth (`cloudWorkspaces`) pre/post enable + post disable. */
  fetchCloudWorkspacesCapability(world: ReadySelfHostWorld): Promise<{ agentGateway: boolean; cloudWorkspaces: boolean }>;
  /** Write the add-on env block + bootstrap the `cloud-workspaces` profile with --wait. */
  configureAndEnableCloudAddon(world: ReadySelfHostWorld, config: CloudAddonConfig): Promise<void>;
  /**
   * Authorize the instance GitHub App + provision one personal sandbox/workspace,
   * run one turn. `onSandboxCreated` MUST be invoked the moment the E2B provider
   * sandbox exists — BEFORE any later step that could throw — so the durable reap
   * is registered even if provisioning/turn crashes mid-flight (SHR-006
   * register-before-create). It is idempotent; calling it more than once is safe.
   */
  provisionAndRunTurn(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    config: CloudAddonConfig,
    onSandboxCreated: (providerSandboxId: string) => Promise<void>,
  ): Promise<CloudAddonProvisionResult>;
  /** Register the provisioned E2B sandbox on the durable ledger for reverse-order reap (SHR-006). */
  registerSandboxReap(world: ReadySelfHostWorld, providerSandboxId: string, config: CloudAddonConfig): Promise<void>;
  /** Pause then wake the sandbox; prove the turn's workspace/session state survives intact. */
  pauseWakeStateIntact(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    providerSandboxId: string,
    config: CloudAddonConfig,
  ): Promise<{ intact: boolean; error?: string }>;
  /** Disable the add-on + reconverge; re-read capability truth + base health. */
  disableAndReassert(world: ReadySelfHostWorld): Promise<{ cloudWorkspacesFalse: boolean; baseHealthy: boolean }>;
}

/**
 * SH-CLOUD-ADDON decision logic (frozen tier-3 contract §`SH-CLOUD-ADDON`).
 * Fail-closed at every boundary; a green result requires the full journey:
 * absence-proven → enable → capability flip → real GitHub-authorized provision +
 * turn → pause/wake state intact → disable truthful + base healthy. The
 * provisioned E2B sandbox is registered for durable reap the moment its provider
 * id is known (before the turn is judged) so a later failure still reaps it.
 */
export async function runCloudAddonCell(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  env: CloudAddonEnvSource,
  ops: CloudAddonCellOps,
): Promise<SelfHostQualCellResult> {
  // Preflight fail-closed: absent founder add-on inputs are a real red, not a skip.
  const config = resolveCloudAddonConfig(env, world.api.baseUrl);
  if (!config.ok) {
    return { status: "failed", reason: { code: "scenario_failure", message: config.reason } };
  }

  // cloudWorkspaces MUST be literal false before enabling (absence posture proven).
  const before = await ops.fetchCloudWorkspacesCapability(world);
  if (before.cloudWorkspaces !== false) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-CLOUD-ADDON: capabilities.cloudWorkspaces was already true before the add-on was enabled (mismatch).",
      },
    };
  }

  await ops.configureAndEnableCloudAddon(world, config.value);

  const after = await ops.fetchCloudWorkspacesCapability(world);
  if (after.cloudWorkspaces !== true) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-CLOUD-ADDON: capabilities.cloudWorkspaces did not flip to true after enabling the add-on (mismatch).",
      },
    };
  }

  // Register the provider sandbox for durable reap the MOMENT it is created —
  // before any step that could throw — via the onSandboxCreated callback (SHR-006
  // register-before-create). Idempotent: guarded so a duplicate id (or a post-hoc
  // safety net below) registers exactly once.
  const registeredSandboxIds = new Set<string>();
  const registerOnce = async (providerSandboxId: string): Promise<void> => {
    if (!providerSandboxId || registeredSandboxIds.has(providerSandboxId)) {
      return;
    }
    registeredSandboxIds.add(providerSandboxId);
    await ops.registerSandboxReap(world, providerSandboxId, config.value);
  };

  const provisioned = await ops.provisionAndRunTurn(world, owner, config.value, registerOnce);
  // Safety net: if the op returned an id it never announced through the callback
  // (older/partial implementations), register it now — still before judging the
  // turn — so a turn/pause failure still tears the sandbox down.
  await registerOnce(provisioned.providerSandboxId);
  if (provisioned.turn.error) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: `SH-CLOUD-ADDON: provisioning/turn errored: ${provisioned.turn.error}` },
    };
  }
  if (!provisioned.turn.ended) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: "SH-CLOUD-ADDON: the provisioned cloud-workspace turn did not end." },
    };
  }
  // The sandbox MUST have been provisioned on the exact configured immutable
  // self-built template (PR7-CONTROL-009): compare the OBSERVED template id to
  // the configured one, so a sandbox that materialized on a different/default
  // template (e.g. a background-materializer orphan) is a red, not a green.
  if (provisioned.e2bTemplateId !== config.value.e2bTemplateName) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message:
          `SH-CLOUD-ADDON: the provisioned sandbox's template "${provisioned.e2bTemplateId}" does not match the ` +
          `configured self-built template "${config.value.e2bTemplateName}"; refusing to green a wrong-template sandbox.`,
      },
    };
  }

  const pauseWake = await ops.pauseWakeStateIntact(world, owner, provisioned.providerSandboxId, config.value);
  if (pauseWake.error) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: `SH-CLOUD-ADDON: pause/wake errored: ${pauseWake.error}` },
    };
  }
  if (!pauseWake.intact) {
    return {
      status: "failed",
      reason: { code: "scenario_failure", message: "SH-CLOUD-ADDON: sandbox state did not survive a pause/wake cycle." },
    };
  }

  const disabled = await ops.disableAndReassert(world);
  if (!disabled.cloudWorkspacesFalse) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-CLOUD-ADDON: disabling the add-on left capabilities.cloudWorkspaces stale-true (disable not truthful).",
      },
    };
  }
  if (!disabled.baseHealthy) {
    return {
      status: "failed",
      reason: {
        code: "scenario_failure",
        message: "SH-CLOUD-ADDON: the base product was not healthy after the add-on was disabled.",
      },
    };
  }

  const evidence: SelfHostCloudAddonEvidenceNoCleanup = {
    kind: "selfhost_cloud_addon",
    artifact_ids: artifactIds(world),
    server_version: world.artifacts.serverImage.version,
    anyharness_version: world.artifacts.anyharness.version,
    harness: "claude",
    api_origin: hostOf(world.api.baseUrl),
    controller_runtime_origin: hostOf(world.runtime.baseUrl),
    github_app_installation_id_hash: sha256Hex(provisioned.githubAppInstallationId),
    // The OBSERVED template id (proven == the configured one just above), not the
    // configured value, so evidence records what actually materialized.
    e2b_template_id: provisioned.e2bTemplateId,
    sandbox_id_hash: sha256Hex(provisioned.sandboxId),
    workspace_id_hash: sha256Hex(provisioned.workspaceId),
    session_id_hash: sha256Hex(provisioned.sessionId),
    turn_completed: true,
    pause_wake_state_intact: true,
    disable_truthful: true,
    base_healthy_after_disable: true,
  };
  return { status: "green", evidence };
}

/**
 * Default production ops for the SCAFFOLDED SH-CLOUD-ADDON cell (PR7-CONTROL-009).
 * `fetchCloudWorkspacesCapability`/`configureAndEnableCloudAddon`/
 * `disableAndReassert` are REAL and verifiable (enable/disable the box profile,
 * read `/meta` capability truth). `provisionAndRunTurn` is NOT yet wired: the
 * self-host product path (instance-GitHub-App authorize → covered repo_environment
 * → personal sandbox materialize on the self-built template → one turn) has no
 * self-host driver seam (managed-cloud's `seedGithubAuthorizationOnBox` is a
 * managed-cloud-only box seed, and PR 7 does not duplicate PR 2's controllers).
 * So the production op FAILS CLOSED (bounded, secret-free) and the cell can NEVER
 * reach green live today — it is scaffolded, not runnable. The green DECISION
 * logic (enable → capability flip → real-GitHub provision + turn → observed
 * template-id match → pause/wake of the TURN'S OWN session → truthful disable) is
 * proven offline by the fake ops; the live green lands only once the drive + the
 * founder E2B/App inputs exist. It never returns a false green.
 */
export const defaultCloudAddonCellOps: CloudAddonCellOps = {
  async fetchCloudWorkspacesCapability(world) {
    return fetchAgentGatewayCapability(world.api.baseUrl);
  },
  async configureAndEnableCloudAddon(world, config) {
    await configureAndEnableCloudAddonProfile(world.control.ssh, config.block, tmpFileIo());
  },
  async provisionAndRunTurn(_world, _owner, _config, _onSandboxCreated) {
    // SCAFFOLDED (PR7-CONTROL-009): fail closed at the self-host GitHub-App
    // authorization boundary — no self-host driver seam exists yet. Returning a
    // bounded turn error keeps this a clean red rather than fabricating a
    // provisioned workspace. When wired, the live impl MUST: call
    // `onSandboxCreated(id)` at E2B create time (before it can throw) so the reap
    // is registered even on a crash; return the OBSERVED `e2bTemplateId` (the cell
    // asserts it == the configured self-built template); and drive one real turn
    // whose workspace/session ids are the ones the pause/wake step re-reads.
    return {
      githubAppInstallationId: "",
      e2bTemplateId: "",
      sandboxId: "",
      workspaceId: "",
      sessionId: "",
      providerSandboxId: "",
      turn: {
        ended: false,
        error:
          "the self-host instance-GitHub-App authorization + self-built-template provisioning drive is not yet " +
          "wired (founder-gated live inputs pending); failing closed rather than fabricating a provisioned workspace",
      },
    };
  },
  async registerSandboxReap(world, providerSandboxId, config) {
    // Durable reverse-order reap on the shared self-host ledger (SHR-006): the
    // E2B sandbox is a separate-account resource that outlives the EC2 box, so it
    // is torn down with the box's OWN E2B key (never the harness's). The E2B probe
    // (`runProbe`) reads its key from RELEASE_E2E_E2B_API_KEY, so the box key is
    // injected under THAT var — not E2B_API_KEY, which the probe ignores. The
    // idempotent provider kill treats an absent sandbox as killed.
    await world.registerCleanup?.("e2b_sandbox", providerSandboxId, async () => {
      await killProviderSandbox(providerSandboxId, boxE2bProbeEnv(config));
    });
  },
  async pauseWakeStateIntact(world, owner, providerSandboxId, config) {
    // SCAFFOLDED interim implementation (PR7-CONTROL-009): this proves the E2B
    // pause/wake MECHANISM survives a filesystem marker, but the frozen contract
    // wants the TURN'S OWN workspace/session state proven intact — i.e. after
    // wake, re-open the session the turn created and confirm its transcript
    // (the reply) is still there, mirroring SH-BASE-TURN's reopen. That needs the
    // real provisioned session id (from the not-yet-wired provisionAndRunTurn), so
    // it is deferred with the rest of the live drive; the marker keeps the
    // mechanism covered until then. Pause via the E2B SDK backdoor (no product
    // pause endpoint), wake through the product's own lever. Bounded fail-closed
    // on any error. The E2B probe env injects the box's key under
    // RELEASE_E2E_E2B_API_KEY (the var runProbe actually reads).
    try {
      const e2bEnv = boxE2bProbeEnv(config);
      const marker = `sh-cloud-addon-${world.run.run_id}`;
      await writeProviderSandboxFile(providerSandboxId, "/home/user/.sh-cloud-addon-marker", marker, e2bEnv);
      await pauseProviderSandbox(providerSandboxId, e2bEnv);
      await wakeCloudSandbox(owner.api);
      const readBack = await readProviderSandboxFile(providerSandboxId, "/home/user/.sh-cloud-addon-marker", e2bEnv);
      return { intact: (readBack.content ?? "").trim() === marker };
    } catch (error) {
      return { intact: false, error: describe(error) };
    }
  },
  async disableAndReassert(world) {
    await disableCloudAddonProfile(world.control.ssh, tmpFileIo());
    // baseHealthy reflects an OBSERVED /health probe: waitForHealth polls
    // /health and THROWS if it never returns 2xx within the window, so reaching
    // the line after it means /health was really observed healthy. A thrown
    // health failure propagates out and the outer cell catch fails the cell (no
    // false green). This mirrors the gateway cell's restart-persistence check.
    await waitForHealth(world.api.baseUrl, { timeoutMs: RESTART_HEALTH_TIMEOUT_MS });
    const baseHealthy = true;
    const capability = await fetchAgentGatewayCapability(world.api.baseUrl);
    return { cloudWorkspacesFalse: capability.cloudWorkspaces === false, baseHealthy };
  },
};

/**
 * The env the E2B `runProbe` reads its key from is `RELEASE_E2E_E2B_API_KEY`
 * (`requireApiKey`), NOT `E2B_API_KEY` (which it overwrites). A self-host box's
 * sandbox is created under the INSTANCE's own key, so the reap/pause probes must
 * run under that key — injected here under the var the probe actually reads, so
 * the probe hits the box's account (not the harness's sandbox-lane account) and a
 * real leak is reaped instead of silently 404'ing as "already gone".
 */
function boxE2bProbeEnv(config: CloudAddonConfig): NodeJS.ProcessEnv {
  return { ...process.env, RELEASE_E2E_E2B_API_KEY: config.block.e2bApiKey };
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

/**
 * Preserves the safe setup phase before the aggregate sanitizer removes any
 * external response or command payload. The separator deliberately avoids a
 * generic `claim failed:` prefix, which previously caused the sanitizer to
 * discard both the phase and an already-safe HTTP status.
 */
export function describeSelfHostSetupFailure(
  phase: "install" | "owner_claim",
  error: unknown,
): string {
  return `SELFHOST-QUAL-1 prerequisite phase=${phase}; ${evidenceSafeSetupError(error)}`;
}

function evidenceSafeSetupError(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "SyntaxError: invalid JSON response (payload withheld from evidence)";
  }
  if (error instanceof Error && ("stdout" in error || "stderr" in error)) {
    return `${error.name}: external command failed (output withheld from evidence)`;
  }
  const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  if (error instanceof Error && typeof status === "number" && "body" in error) {
    const prefix = /^(.*?->\s*\d+)/.exec(error.message)?.[1] ?? `request failed with status ${status}`;
    return `${error.name}: ${prefix} (response body withheld from evidence)`;
  }
  return describe(error);
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
