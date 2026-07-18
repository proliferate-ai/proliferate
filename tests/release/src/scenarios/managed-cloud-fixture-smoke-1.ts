import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile, rename, readFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import {
  COVERED_REPO_DEFAULT_BRANCH,
  COVERED_REPO_NAME,
  COVERED_REPO_OWNER,
  EXPECTED_BOT_LOGIN,
  resolveBotSeedForAutomation,
  resolveWorldConstructionInputs,
  type CloudProvision1ConstructionInputs,
} from "./cloud-provision-1.js";
import type { CellEvidenceV1, ManagedCloudFixtureSmokeEvidenceV1 } from "../evidence/schema.js";
import { callbackRelay, type CallbackRelay, type CapturedDelivery } from "../fixtures/callback-relay.js";
import {
  billingThreshold,
  billingThresholdReceiptFile,
  restoreBillingFixtureAdjustment,
} from "../fixtures/billing-threshold.js";
import {
  injectFailureAt,
  providerProcessWithExactExecutablePresent,
} from "../fixtures/failure-injection.js";
import type { FailureInjectionHandle } from "../fixtures/failure-injection.js";
import {
  findProviderSandbox,
  killProviderSandbox,
} from "../fixtures/e2b-verify.js";
import {
  ensureCloudSandboxRow,
  warmPersonalCloudSandbox,
} from "../fixtures/cloud-sandbox.js";
import {
  authenticatedActor,
  type AuthenticatedActor,
} from "../fixtures/authenticated-actor.js";
import { selectCheapestEligibleClaudeModel } from "../services/qualification-litellm.js";
import { CALLBACK_RELAY_DEFAULT_PORT } from "../fixtures/callback-relay.js";
import { REMOTE_WORKDIR } from "../worlds/managed-cloud/ingress.js";
import { RELAY_DIRNAME } from "../worlds/managed-cloud/callback-relay-agent.js";
import { parseLastJsonLine } from "../worlds/managed-cloud/box-seeds.js";
import {
  persistRotatedBotSeedDurable,
  seedGithubAuthorizationOnBox,
  seedUnlimitedCloudEntitlementOnBox,
} from "../worlds/managed-cloud/box-seeds.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  STRIPE_INTENT_RECOVERY_WINDOW_MS,
  stripeCleanupReplayHandlers,
  type StripeHttp,
} from "../fixtures/stripe-test-clock.js";
import {
  createRunCustomer,
  createWebhookEndpoint,
  deleteCustomerByIdHttp,
  deleteRunCustomersByTag,
  deleteWebhookEndpointById,
  encodeWebhookEndpointIntentRef,
  findWebhookEndpointByUrl,
  findWebhookEndpointsByUrl,
  webhookEndpointUrl,
} from "../fixtures/stripe-smoke-resources.js";
import {
  FIXTURE_REPLAY_KINDS,
  encodeE2bSandboxCleanupIdentity,
} from "../fixtures/managed-cloud-fixture-replay.js";
import {
  replayManagedCloudFixturesInFreshProcess,
  type ManagedCloudFixtureReplayReportV1,
} from "../cli/replay-managed-cloud-fixtures.js";
export {
  decodeE2bSandboxCleanupIdentity,
  encodeE2bSandboxCleanupIdentity,
} from "../fixtures/managed-cloud-fixture-replay.js";
export type { E2bSandboxCleanupIdentity } from "../fixtures/managed-cloud-fixture-replay.js";
import {
  sweepAwsForRun,
  sweepE2bForTemplate,
  sweepFilesystemPaths,
  sweepProcessHostFromAws,
} from "../worlds/managed-cloud/sweeps.js";
import { loadCleanupLedger } from "../worlds/local-workspace/cleanup-ledger.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { CandidateStripeConfig } from "../worlds/managed-cloud/ingress.js";
import type { ManagedCloudCleanupEvidence } from "../worlds/managed-cloud/cleanup-kinds.js";
import { sharedTemplateCustodyPath } from "../worlds/managed-cloud/shared-template-custody.js";
import {
  constructManagedCloudWorld,
  type ConstructManagedCloudWorldOptions,
  type CleanupIntentHandle,
  type ManagedCloudWorld,
} from "../worlds/managed-cloud/world.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";

/**
 * MANAGED-CLOUD-FIXTURE-SMOKE-1 (frozen spec "Prove Managed-Cloud World and
 * Shared Fixtures Live"). One infrastructure matrix scenario proving the merged
 * managed-cloud shared fixtures execute one bounded REAL smoke operation each
 * and recover after process interruption — the prerequisite platform before the
 * 17 CLOUD-* journeys fan out. Five independently-judged cells share ONE
 * ManagedCloudWorld:
 *
 *   callback-relay    — a real Stripe test-mode op fires a signed callback; the
 *                       relay holds → replays byte-for-byte; duplicate delivery
 *                       exercises real idempotency; spool file modes + PID
 *                       ownership proven.
 *   stripe-test-clock — real test clock + subscribed customer; advance yields a
 *                       real renewal event; recovery from persisted identity;
 *                       verified deletion; live-mode fail-closed.
 *   billing-threshold — position the LLM ledger below one request's cost; one
 *                       real gateway request crosses it; observe the product
 *                       gate; restore + reload proves restoration.
 *   failure-injection — runtime_readiness boundary (kill AnyHarness before the
 *                       first ready transition); recover in place through the
 *                       normal product materialization path;
 *                       control action + relay spool unaffected.
 *   cleanup-replay    — fresh executor replays the ledger with no in-memory
 *                       closures; world close; provider sweeps show zero owned.
 *
 * Structured around a `FixtureSmokeDriver` seam so unit tests fake the world +
 * every privileged step offline. Extends merged primitives only (no second
 * callback server, cleanup ledger, Stripe client, E2B controller, or world
 * constructor).
 */

export const MANAGED_CLOUD_FIXTURE_SMOKE_1_ID = "MANAGED-CLOUD-FIXTURE-SMOKE-1";

/** The five cell names, in the fixed execution order (cleanup-replay ALWAYS last). */
export const FIXTURE_SMOKE_CELL_NAMES = [
  "callback-relay",
  "stripe-test-clock",
  "billing-threshold",
  "failure-injection",
  "cleanup-replay",
] as const;
export type FixtureSmokeCellName = (typeof FIXTURE_SMOKE_CELL_NAMES)[number];

/** Bounded waits (overridable in tests via runtime deps). */
const CALLBACK_POLL_TIMEOUT_MS = 120_000;
const CALLBACK_POLL_INTERVAL_MS = 3_000;
const CLOCK_READY_TIMEOUT_MS = 120_000;
const CLOCK_READY_INTERVAL_MS = 3_000;
const RENEWAL_EVENT_TIMEOUT_MS = 120_000;
const FAILURE_RECOVERY_TIMEOUT_MS = 180_000;

type ScenarioCellOutcomeWithEvidence = ScenarioCellOutcome & { evidence?: CellEvidenceV1 };

export const managedCloudFixtureSmoke1: ScenarioDefinition = {
  id: MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
  kind: "matrix",
  title:
    "prove the merged managed-cloud shared fixtures live: one bounded real smoke op per fixture " +
    "(callback relay, Stripe test clock, billing threshold, failure injection) + durable cleanup replay",
  registryFlowRef: "specs/developing/testing/flows.md#cloud-provision",
  lanes: ["sandbox"],
  requiredEnv: [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_E2B_TEAM_ID",
    "RELEASE_E2E_CLOUD_AWS_REGION",
    "RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET",
    // The fixture smoke constructs the same public-TLS managed-cloud world as
    // CLOUD-PROVISION-1. These must be declared here so the runner resolves
    // them into ctx.env before resolveWorldConstructionInputs() is called.
    "RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64",
    "RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64",
    "STRIPE_TEST_SECRET_KEY",
  ],
  expandCells: (): ScenarioCellSpec[] =>
    FIXTURE_SMOKE_CELL_NAMES.map((cell) => ({ dimensions: { cell } })),
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => {
    const name = cell.dimensions.cell;
    return [{ description: `[${cell.cell_id}] run the ${name} shared-fixture smoke cell against the shared managed-cloud world` }];
  },
  runCells: (ctx, cells): Promise<ScenarioCellOutcome[]> =>
    runFixtureSmokeCells(ctx, cells, defaultFixtureSmokeDriver),
};

/** The webhook endpoint two-stage-custody intent file recorded under runDir. */
export const WEBHOOK_INTENT_FILENAME = "stripe-webhook-endpoint-intent.json";
export const WEBHOOK_CUSTODY_DIRNAME = "cleanup-custody";

interface WebhookEndpointIntent {
  intentRef: string;
  endpointId: string | null;
  runTag: string;
  createdAt: string;
}

/** Resolved Stripe preparation done BEFORE world construction (two-stage custody). */
export interface StripePreparation {
  /**
   * The SCOPED run directory the fixture-smoke world lives in
   * (`<inputs.runDir>/fixture-smoke`). The world's `run_directory` cleanup =
   * rm -rf(this dir), so it must NEVER be the parent `inputs.runDir` — that
   * holds the builder's candidate artifacts + candidate map (deleting it broke
   * every cell live when CLOUD-PROVISION-1's world close ran first). All the
   * fixture-smoke env files + the webhook intent file live under here.
   */
  scopedRunDir: string;
  /** Path to a 0600 env file holding STRIPE_SECRET_KEY (under scopedRunDir/secrets). */
  secretsEnvFilePath: string;
  /** Path to a 0600 env file holding STRIPE_WEBHOOK_SECRET (+ optional E2B webhook secret). */
  webhookSecretEnvFilePath: string;
  /** The run subdomain the webhook endpoint + candidate API are on. */
  subdomain: string;
  /** The created webhook endpoint id (we_…), for post-world ledger adoption. */
  webhookEndpointId: string;
  /** The durable intent ref (url-based) recorded before the create. */
  webhookIntentRef: string;
  /** Durable parent-run journal, intentionally outside the world-deleted scoped directory. */
  webhookIntentFilePath: string;
}

/** Mutable state threaded across the cells of one shared world. */
interface SmokeState {
  runTag: string;
  secretKey: string;
  prep: StripePreparation;
  /** AWS region + hosted zone for cell E's post-close sweep (not exposed on the world handle). */
  aws: { region: string; hostedZoneId: string };
  /**
   * The ONE shared owner actor for this smoke. The frozen spec's isolation
   * section says "use a fresh actor/billing subject for this smoke" (SINGULAR):
   * one owner actor across all cells is spec-conformant AND required — the
   * server's `claim_first_run` raises `SetupClosedError` once any user exists, so
   * `authenticatedActor` (which POSTs the one-time `/setup` claim) can only ever
   * succeed ONCE against the shared world. Cells B/C/D therefore share this one
   * actor via `ensureOwnerActor`, which memoizes it here on first call.
   */
  ownerActor?: AuthenticatedActor;
  /** Set by cell E's extra replay customer / cell A/B ids for the sweep + evidence. */
  extraReplayCustomerId?: string;
}

/**
 * Lazily creates the ONE shared owner actor (memoized on `state.ownerActor`) via
 * the driver's `createActor` seam + `trackActorSubjects`, so a second call
 * NEVER re-claims `/setup`. Cells B/C/D call this instead of creating their own
 * actor. Kept inside the driver seam so offline fakes still control creation.
 */
export async function ensureOwnerActor(
  world: ManagedCloudWorld,
  state: SmokeState,
  driver: Pick<FixtureSmokeDriver, "createActor" | "trackActorSubjects">,
): Promise<AuthenticatedActor> {
  if (!state.ownerActor) {
    const actor = await driver.createActor(world);
    await driver.trackActorSubjects(world, actor);
    state.ownerActor = actor;
  }
  return state.ownerActor;
}

/** One cell's real observed result, mapped by the orchestration into an outcome + evidence. */
export interface FixtureSmokeCellResult {
  externalIds: string[];
  observedTransition: string;
  cleanupEntries: string[];
  /** Only cleanup-replay populates this. */
  providerSweeps?: ManagedCloudFixtureSmokeEvidenceV1["provider_sweeps"];
}

/**
 * Every privileged/stateful step, factored out so unit tests fake the world +
 * fixtures + providers entirely. Production wiring (`defaultFixtureSmokeDriver`)
 * calls the real fixtures/world the merged workstreams own.
 */
export interface FixtureSmokeDriver {
  /**
   * Two-stage custody: create the run-scoped Stripe webhook endpoint BEFORE the
   * world exists, recording it in a durable scenario-owned intent file under
   * runDir (covers the pre-world crash window), and write the 0600 Stripe env
   * files the world's `stripe` config points at.
   */
  prepareStripe(inputs: CloudProvision1ConstructionInputs, secretKey: string): Promise<StripePreparation>;
  buildWorld(inputs: CloudProvision1ConstructionInputs, prep: StripePreparation): Promise<ManagedCloudWorld>;
  /**
   * AFTER world construction, register the pre-created webhook endpoint into the
   * world's cleanup ledger (intent → immediately markAcquired with the real
   * we_ id) so world.close() deletes it, and update the scenario intent file.
   */
  adoptWebhookIntent(world: ManagedCloudWorld, prep: StripePreparation, secretKey: string): Promise<void>;
  /**
   * Best-effort direct delete of the pre-created webhook endpoint (tolerates a
   * missing endpoint). Called inline when `buildWorld` throws AFTER `prepareStripe`
   * created the endpoint — an ordinary construction failure should not leak it
   * (the durable intent file remains the crash-window backstop for a runner death).
   */
  deleteWebhookEndpoint(prep: StripePreparation, secretKey: string): Promise<void>;
  /**
   * Creates the fresh cloud-surface owner actor. Called at most ONCE per world
   * via `ensureOwnerActor` (memoized on `SmokeState`) — a second call would
   * re-POST the one-time `/setup` claim and fail with `SetupClosedError`. Fakeable
   * so offline tests can assert the single-creation contract.
   */
  createActor(world: ManagedCloudWorld): Promise<AuthenticatedActor>;
  /** Enrols the actor's LiteLLM subjects for world-close cleanup (idempotent). */
  trackActorSubjects(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<void>;
  runCallbackRelayCell(world: ManagedCloudWorld, state: SmokeState): Promise<FixtureSmokeCellResult>;
  runStripeTestClockCell(world: ManagedCloudWorld, state: SmokeState): Promise<FixtureSmokeCellResult>;
  runBillingThresholdCell(world: ManagedCloudWorld, state: SmokeState): Promise<FixtureSmokeCellResult>;
  runFailureInjectionCell(world: ManagedCloudWorld, state: SmokeState): Promise<FixtureSmokeCellResult>;
  /**
   * The cleanup-replay cell: create one extra replay resource, replay the ledger
   * from a FRESH executor with no closures, sweep every provider, close the
   * world (via `closeWorld`), and assert zero remaining. Returns the cell result.
   */
  runCleanupReplayCell(
    world: ManagedCloudWorld,
    state: SmokeState,
    closeWorld: () => Promise<ManagedCloudCleanupEvidence | null>,
  ): Promise<FixtureSmokeCellResult>;
  closeWorld(world: ManagedCloudWorld): Promise<ManagedCloudCleanupEvidence>;
}

/**
 * The real per-scenario orchestration, independent of matrix plumbing so it is
 * directly unit-testable against a fake `FixtureSmokeDriver`. Builds ONE world
 * shared by all assigned cells, runs the assigned cells in the fixed order, and
 * ALWAYS closes the world exactly once (cleanup-replay closes it when assigned;
 * otherwise a finally-close runs with no emitted outcome).
 */
export async function runFixtureSmokeCells(
  ctx: ScenarioRunContext,
  cells: readonly PlannedCellV1[],
  driver: FixtureSmokeDriver,
): Promise<ScenarioCellOutcome[]> {
  const assigned = new Map(cells.map((cell) => [cell.dimensions.cell as FixtureSmokeCellName, cell]));

  // Fail-closed preflight: resolve the test-mode key BEFORE any side effect. A
  // missing key → every assigned cell failed with a bounded reason; a live key
  // → fail closed (never touch a live Stripe account).
  const keyResult = resolveSmokeSecretKey(ctx);
  if (!keyResult.ok) {
    return failAllAssigned(cells, keyResult.reason);
  }

  const inputs = resolveWorldConstructionInputs(ctx);
  if (!inputs.ok) {
    return failAllAssigned(cells, inputs.reason);
  }

  const runTag = `${inputs.value.run.run_id}:${inputs.value.run.shard_id}`;

  let prep: StripePreparation;
  try {
    prep = await driver.prepareStripe(inputs.value, keyResult.secretKey);
  } catch (error) {
    return failAllAssigned(cells, `stripe preparation failed: ${describe(error)}`);
  }

  let world: ManagedCloudWorld;
  try {
    world = await driver.buildWorld(inputs.value, prep);
  } catch (error) {
    // prepareStripe already created the run-scoped webhook endpoint; an ordinary
    // construction failure would otherwise leak it (the durable intent file only
    // covers a full runner DEATH — nothing replays it inline). Delete it directly
    // now (best-effort, tolerates a missing endpoint).
    try {
      await driver.deleteWebhookEndpoint(prep, keyResult.secretKey);
      return failAllAssigned(cells, `world construction failed: ${describe(error)}`);
    } catch (cleanupError) {
      return failAllAssigned(
        cells,
        `world construction failed: ${describe(error)}; pre-world Stripe cleanup also failed: ${describe(cleanupError)}`,
      );
    }
  }

  const state: SmokeState = {
    runTag,
    secretKey: keyResult.secretKey,
    prep,
    aws: { region: inputs.value.aws.region, hostedZoneId: inputs.value.aws.hostedZoneId },
  };
  const outcomes: ScenarioCellOutcomeWithEvidence[] = [];
  let worldClosed = false;
  let closeEvidence: ManagedCloudCleanupEvidence | null = null;
  let orchestrationError: Error | null = null;
  // Returns the world-close cleanup evidence on the call that actually closed it,
  // and null on any subsequent (already-closed) call — so cell E can gate on the
  // real close evidence (failed count + every deletion boolean).
  const closeOnce = async (): Promise<ManagedCloudCleanupEvidence | null> => {
    if (worldClosed) {
      return null;
    }
    worldClosed = true;
    closeEvidence = await driver.closeWorld(world);
    return closeEvidence;
  };

  try {
    // Adopt the pre-created webhook endpoint into the world ledger so world close
    // deletes it (belt-and-suspenders with the scenario intent file).
    try {
      await driver.adoptWebhookIntent(world, prep, state.secretKey);
    } catch (adoptionError) {
      try {
        await driver.deleteWebhookEndpoint(prep, state.secretKey);
      } catch (cleanupError) {
        throw new Error(
          `webhook cleanup-ledger adoption failed: ${describe(adoptionError)}; direct cleanup also failed: ` +
            `${describe(cleanupError)} (durable journal preserved at ${prep.webhookIntentFilePath}).`,
        );
      }
      throw new Error(
        `webhook cleanup-ledger adoption failed: ${describe(adoptionError)}; endpoint was deleted directly.`,
      );
    }

    const worldIdentity = worldEvidenceIdentity(world);
    const artifactIds = worldArtifactIds(world);

    // Non-terminal cells first (each independent; a failure never poisons a
    // sibling). cleanup-replay is handled last, separately, since it closes the
    // world.
    const orderedNonTerminal: Array<[FixtureSmokeCellName, (w: ManagedCloudWorld, s: SmokeState) => Promise<FixtureSmokeCellResult>]> = [
      ["callback-relay", driver.runCallbackRelayCell],
      ["stripe-test-clock", driver.runStripeTestClockCell],
      ["billing-threshold", driver.runBillingThresholdCell],
      ["failure-injection", driver.runFailureInjectionCell],
    ];

    for (const [name, run] of orderedNonTerminal) {
      const cell = assigned.get(name);
      if (!cell) {
        continue;
      }
      outcomes.push(await runOneCell(cell, worldIdentity, artifactIds, () => run.call(driver, world, state)));
    }

    const cleanupCell = assigned.get("cleanup-replay");
    if (cleanupCell) {
      outcomes.push(
        await runOneCell(cleanupCell, worldIdentity, artifactIds, () =>
          driver.runCleanupReplayCell(world, state, closeOnce),
        ),
      );
    }
  } catch (error) {
    orchestrationError = error instanceof Error ? error : new Error(describe(error));
  } finally {
    // cleanup-replay closes the world when assigned; otherwise close it here
    // with no emitted outcome (the world must never leak).
    try {
      const finalEvidence = await closeOnce();
      if (finalEvidence) {
        if (assigned.has("cleanup-replay")) {
          throw new Error(
            "cleanup-replay returned without consuming the real world-close receipt; its green result is invalid.",
          );
        }
        if (finalEvidence.failed > 0 || !allCleanupBooleansTrue(finalEvidence)) {
          throw new Error(
            `world close did not fully reconcile (failed=${finalEvidence.failed}, ${cleanupBooleanSummary(finalEvidence)}).`,
          );
        }
      }
    } catch (error) {
      const cleanupError = error instanceof Error ? error : new Error(describe(error));
      orchestrationError = orchestrationError
        ? new Error(`${orchestrationError.message}; final cleanup also failed: ${cleanupError.message}`)
        : cleanupError;
    }
  }

  if (orchestrationError) {
    const byCell = new Map(outcomes.map((outcome) => [outcome.cellId, outcome]));
    return cells.map((cell) => {
      const prior = byCell.get(cell.cell_id);
      if (prior?.status !== "green") {
        if (prior) {
          return {
            ...prior,
            reason: {
              code: prior.reason?.code ?? "scenario_failure",
              message: `${prior.reason?.message ?? "cell failed"}; required orchestration/cleanup also failed: ` +
                describe(orchestrationError),
            },
          };
        }
        return {
          cellId: cell.cell_id,
          status: "failed",
          reason: { code: "scenario_failure", message: describe(orchestrationError) },
        };
      }
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: {
          code: "scenario_failure",
          message: `cell body completed but required orchestration/cleanup failed: ${describe(orchestrationError)}`,
        },
      };
    });
  }

  return outcomes;
}

/** Runs one cell body, mapping a thrown error to a clean `failed` outcome and a
 * result into a green outcome carrying complete kind-scoped evidence. */
async function runOneCell(
  cell: PlannedCellV1,
  worldIdentity: ManagedCloudFixtureSmokeEvidenceV1["world"],
  artifactIds: string[],
  body: () => Promise<FixtureSmokeCellResult>,
): Promise<ScenarioCellOutcomeWithEvidence> {
  try {
    const result = await body();
    const evidence: ManagedCloudFixtureSmokeEvidenceV1 = {
      kind: "managed_cloud_fixture_smoke",
      artifact_ids: artifactIds,
      world: worldIdentity,
      cells: [
        {
          cell_id: cell.cell_id,
          external_ids: result.externalIds,
          observed_transition: result.observedTransition,
          cleanup_entries: result.cleanupEntries,
        },
      ],
      provider_sweeps: result.providerSweeps ?? [],
    };
    return { cellId: cell.cell_id, status: "green", evidence };
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: describe(error) },
    };
  }
}

function failAllAssigned(cells: readonly PlannedCellV1[], reason: string): ScenarioCellOutcome[] {
  return cells.map((cell) => ({
    cellId: cell.cell_id,
    status: "failed",
    reason: { code: "scenario_failure", message: reason },
  }));
}

type SmokeSecretKeyResolution = { ok: true; secretKey: string } | { ok: false; reason: string };

/** Resolves the test-mode Stripe key, failing closed on missing/live-mode. */
export function resolveSmokeSecretKey(ctx: ScenarioRunContext): SmokeSecretKeyResolution {
  const raw = ctx.env.get("STRIPE_TEST_SECRET_KEY")?.trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        "STRIPE_TEST_SECRET_KEY is not set; the fixture smoke cannot run a real test-mode Stripe operation " +
        "(missing protected credential — no side effects).",
    };
  }
  if (isLiveModeSecretKey(raw)) {
    return {
      ok: false,
      reason:
        "STRIPE_TEST_SECRET_KEY is a LIVE-mode key (sk_live_…/rk_live_…); refusing to run the qualification " +
        "fixture smoke against a live Stripe account (fail-closed).",
    };
  }
  return { ok: true, secretKey: raw };
}

/** The world identity block for evidence (source sha + server digest + template ids). */
function worldEvidenceIdentity(world: ManagedCloudWorld): ManagedCloudFixtureSmokeEvidenceV1["world"] {
  return {
    source_sha: world.run.source_sha,
    // No dedicated server image digest is exposed on the world; the materialized
    // server artifact's sha256 is the exact-identity digest under test.
    server_digest: world.artifacts.server.sha256,
    e2b_template_id: world.artifacts.template.templateId,
    e2b_template_build_id: world.artifacts.template.buildId,
    e2b_template_input_hash: world.artifacts.template.inputHash,
  };
}

function worldArtifactIds(world: ManagedCloudWorld): string[] {
  return [
    world.artifacts.server.artifact_id,
    world.artifacts.anyharness.artifact_id,
    world.artifacts.worker.artifact_id,
    world.artifacts.supervisor.artifact_id,
    world.artifacts.credentialHelper.artifact_id,
    world.artifacts.desktopRenderer.artifact_id,
    world.artifacts.template.artifact_id,
    world.artifacts.candidateApi.artifact_id,
  ];
}

// ---------------------------------------------------------------------------
// Duplicate-delivery byte-identity witness (pure; unit-tested against a fake
// manifest). Never copies raw bytes — only sha256 + evt id.
// ---------------------------------------------------------------------------

/**
 * Proves a duplicated delivery was forwarded byte-for-byte: `after` must contain
 * a NEW forwarded/replayed row for `providerEventId` whose `bytesSha256` equals
 * the sha of the original held/replayed row for that event in `before`. Returns
 * the witnessed sha256. Throws when no baseline row exists, no new row appeared,
 * or the sha differs (a byte-level mismatch — a harness defect).
 */
export function assertDuplicateDeliveryByteIdentity(
  before: readonly CapturedDelivery[],
  after: readonly CapturedDelivery[],
  providerEventId: string,
): { bytesSha256: string } {
  const forId = (rows: readonly CapturedDelivery[]): CapturedDelivery[] =>
    rows.filter((row) => row.providerEventId === providerEventId);
  const baselineRows = forId(before);
  if (baselineRows.length === 0) {
    throw new Error(
      `assertDuplicateDeliveryByteIdentity: no baseline delivery row for event ${providerEventId} to compare against.`,
    );
  }
  const baselineSha = baselineRows[0]!.bytesSha256;
  if (!baselineRows.every((row) => row.bytesSha256 === baselineSha)) {
    throw new Error(
      `assertDuplicateDeliveryByteIdentity: baseline rows for ${providerEventId} disagree on bytesSha256.`,
    );
  }
  const afterRows = forId(after);
  if (afterRows.length <= baselineRows.length) {
    throw new Error(
      `assertDuplicateDeliveryByteIdentity: no NEW forwarded row appeared for ${providerEventId} after the ` +
        `duplicate delivery (before=${baselineRows.length}, after=${afterRows.length}).`,
    );
  }
  const mismatched = afterRows.find((row) => row.bytesSha256 !== baselineSha);
  if (mismatched) {
    throw new Error(
      `assertDuplicateDeliveryByteIdentity: a forwarded row for ${providerEventId} has bytesSha256 ` +
        `${mismatched.bytesSha256}, not the byte-identical ${baselineSha} — the relay did not forward verbatim.`,
    );
  }
  return { bytesSha256: baselineSha };
}

// ---------------------------------------------------------------------------
// Production driver wiring
// ---------------------------------------------------------------------------

/** Runtime deps overridable in unit tests so no bound is waited out live. */
export interface FixtureSmokeRuntimeDeps {
  http: StripeHttp;
  /** The world constructor (injectable so a unit test can capture `options.runDir`). */
  constructWorld: (options: ConstructManagedCloudWorldOptions) => Promise<ManagedCloudWorld>;
  /** Must cross a real OS-process boundary in production. */
  replayFixturesFresh: (
    runDir: string,
    runId: string,
    shardId: string,
  ) => Promise<ManagedCloudFixtureReplayReportV1>;
}

const productionDeps: FixtureSmokeRuntimeDeps = {
  http: defaultStripeHttp,
  constructWorld: constructManagedCloudWorld,
  replayFixturesFresh: (runDir, runId, shardId) =>
    replayManagedCloudFixturesInFreshProcess({ runDir, runId, shardId }),
};

/** Reused-fixture cast (see cloud-provision-1's `asAuthenticatedActorWorld`). */
function asAuthenticatedActorWorld(world: ManagedCloudWorld): ReadyLocalWorld {
  return world as unknown as ReadyLocalWorld;
}

async function writeSecretEnvFile(dir: string, fileName: string, values: Record<string, string>): Promise<string> {
  const filePath = path.join(dir, fileName);
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await writeFile(filePath, `${body}\n`, { mode: 0o600 });
  return filePath;
}

/** Atomic (tmp+rename) 0600 write of the scenario-owned webhook intent file. */
async function writeWebhookIntentFile(filePath: string, intent: WebhookEndpointIntent): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(intent)}\n`, { mode: 0o600 });
  await rename(tmp, filePath);
}

async function removeWebhookIntentFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

/**
 * Replays a pre-world webhook cleanup journal using only persisted bounded
 * identity. This runs before a new endpoint can be created and removes the
 * journal only after deletion or an exhaustive, out-of-window absence proof.
 */
export async function reconcileWebhookIntentFile(
  filePath: string,
  expectedRunTag: string,
  expectedUrl: string,
  secretKey: string,
  http: StripeHttp,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<WebhookEndpointIntent>;
  const expectedIntentRef = `intent:webhook_endpoint:url=${expectedUrl}`;
  if (parsed.runTag !== expectedRunTag || parsed.intentRef !== expectedIntentRef || typeof parsed.createdAt !== "string") {
    throw new Error("webhook cleanup journal identity is malformed or belongs to a different run.");
  }
  if (parsed.endpointId !== null && typeof parsed.endpointId !== "string") {
    throw new Error("webhook cleanup journal endpoint id is malformed.");
  }
  const found = await findWebhookEndpointsByUrl(
    { secretKey, url: expectedUrl, runTag: expectedRunTag },
    http,
  );
  if (found.length > 0) {
    if (parsed.endpointId && !found.some((match) => match.endpointId === parsed.endpointId)) {
      throw new Error("webhook cleanup journal id does not match the run-owned endpoint at its exact URL.");
    }
    for (const match of found) {
      await deleteWebhookEndpointById(secretKey, match.endpointId, http);
    }
    const remaining = await findWebhookEndpointsByUrl(
      { secretKey, url: expectedUrl, runTag: expectedRunTag },
      http,
    );
    if (remaining.length > 0) {
      throw new Error(
        `webhook cleanup journal still has ${remaining.length} exact run-owned endpoint(s) after delete; preserving custody.`,
      );
    }
    await removeWebhookIntentFile(filePath);
    return;
  }
  const createdAt = Date.parse(parsed.createdAt);
  if (Number.isNaN(createdAt) || Date.now() - createdAt < STRIPE_INTENT_RECOVERY_WINDOW_MS) {
    throw new Error(
      "webhook cleanup journal has no visible endpoint yet; keeping it durable and retryable rather than reconciling success.",
    );
  }
  await removeWebhookIntentFile(filePath);
}

/** The build-written sidecar naming the subdomain baked into the renderer. */
const SUBDOMAIN_SIDECAR_FILENAME = "cloud-world-subdomain.json";
/** The fixture-smoke world's SCOPED run dir under the shared parent run dir. */
export const FIXTURE_SMOKE_WORLD_SUBDIR = "fixture-smoke";

/** Resolves the SCOPED fixture-smoke world run dir under the shared parent run dir. */
export function fixtureSmokeScopedRunDir(parentRunDir: string): string {
  return path.join(parentRunDir, FIXTURE_SMOKE_WORLD_SUBDIR);
}

/**
 * Reads the run subdomain from the build sidecar (written by the builder in the
 * PARENT run dir — the renderer has that exact subdomain baked in). Falls back to
 * `world.ts`'s `allocateSubdomain` formula only when the sidecar is absent (the
 * live run confirmed the sidecar value equals the formula). Returns the value
 * plus whether it came from the sidecar (so the caller can copy the sidecar into
 * the scoped dir when present).
 */
async function readRunSubdomain(
  parentRunDir: string,
  fallbackZone: string,
  runId: string,
  shardId: string,
): Promise<{ subdomain: string; fromSidecar: boolean }> {
  try {
    const raw = await readFile(path.join(parentRunDir, SUBDOMAIN_SIDECAR_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as { subdomain?: unknown };
    if (typeof parsed.subdomain === "string" && parsed.subdomain.length > 0) {
      return { subdomain: parsed.subdomain, fromSidecar: true };
    }
  } catch {
    // fall through to the local formula (mirrors world.ts allocateSubdomain).
  }
  const label = `mcq-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return { subdomain: `${label}.${fallbackZone}`, fromSidecar: false };
}

export function createFixtureSmokeDriver(deps: Partial<FixtureSmokeRuntimeDeps> = {}): FixtureSmokeDriver {
  const http = deps.http ?? productionDeps.http;
  const constructWorld = deps.constructWorld ?? productionDeps.constructWorld;
  const replayFixturesFresh = deps.replayFixturesFresh ?? productionDeps.replayFixturesFresh;
  return {
    async prepareStripe(inputs, secretKey) {
      // Fail closed on a live-mode key (reuse the fixture guard) BEFORE any create.
      if (isLiveModeSecretKey(secretKey)) {
        throw new Error("prepareStripe: refusing a LIVE-mode Stripe secret key (sk_live_…/rk_live_…).");
      }
      const runTag = `${inputs.run.run_id}:${inputs.run.shard_id}`;
      // SCOPED run dir: the fixture-smoke world lives in its own subdir so its
      // `run_directory` cleanup (rm -rf) never touches the shared parent run dir,
      // which holds the builder's candidate artifacts + candidate map. All the
      // fixture-smoke env files + the webhook intent file live under here.
      const scopedRunDir = fixtureSmokeScopedRunDir(inputs.runDir);
      await mkdir(scopedRunDir, { recursive: true });
      const custodyDir = path.join(inputs.runDir, WEBHOOK_CUSTODY_DIRNAME);
      await mkdir(custodyDir, { recursive: true, mode: 0o700 });
      await chmod(custodyDir, 0o700);
      const webhookIntentFilePath = path.join(custodyDir, WEBHOOK_INTENT_FILENAME);
      const secretsDir = path.join(scopedRunDir, "secrets");
      await mkdir(secretsDir, { recursive: true, mode: 0o700 });
      const secretsEnvFilePath = await writeSecretEnvFile(secretsDir, "stripe.env", {
        STRIPE_SECRET_KEY: secretKey,
      });

      // The subdomain is read from the PARENT run dir's build sidecar (the builder
      // wrote it there; the renderer has that exact value baked in). When present,
      // COPY the sidecar into the scoped dir so the world constructor's own
      // readBuildSubdomain(scopedRunDir) reads the exact build value rather than
      // relying on formula equality (the formula is a verified fallback only).
      const { subdomain, fromSidecar } = await readRunSubdomain(
        inputs.runDir,
        inputs.aws.zoneName,
        inputs.run.run_id,
        inputs.run.shard_id,
      );
      await reconcileWebhookIntentFile(
        webhookIntentFilePath,
        runTag,
        webhookEndpointUrl(subdomain),
        secretKey,
        http,
      );
      if (fromSidecar) {
        await copyFile(
          path.join(inputs.runDir, SUBDOMAIN_SIDECAR_FILENAME),
          path.join(scopedRunDir, SUBDOMAIN_SIDECAR_FILENAME),
        );
      }

      // STAGE 1 (pre-create): record the durable scenario-owned intent BEFORE the
      // webhook endpoint exists, so a crash in the create→acquire window leaves a
      // recovery identity (the url) on disk (under the SCOPED dir, alongside the
      // world's ledger). The world does not exist yet, so its ledger cannot own
      // this yet — the scenario intent file bridges that window.
      const intentRef = encodeWebhookEndpointIntentRef(subdomain);
      const createdAt = new Date().toISOString();
      await writeWebhookIntentFile(webhookIntentFilePath, { intentRef, endpointId: null, runTag, createdAt });

      const created = await createWebhookEndpoint({ secretKey, subdomain, runTag }, http);

      // STAGE 1b: update the intent file with the real id the instant Stripe returns.
      await writeWebhookIntentFile(webhookIntentFilePath, {
        intentRef,
        endpointId: created.endpointId,
        runTag,
        createdAt,
      });

      // The two webhook signing secrets live in the SERVER env only (the relay
      // forwards signed bytes untouched). E2B webhook secret is optional.
      const webhookValues: Record<string, string> = { STRIPE_WEBHOOK_SECRET: created.secret };
      const e2bWebhookSecret = process.env.RELEASE_E2E_CLOUD_E2B_WEBHOOK_SECRET?.trim();
      if (e2bWebhookSecret) {
        webhookValues.E2B_WEBHOOK_SIGNATURE_SECRET = e2bWebhookSecret;
      }
      const webhookSecretEnvFilePath = await writeSecretEnvFile(secretsDir, "stripe-webhook.env", webhookValues);

      return {
        scopedRunDir,
        secretsEnvFilePath,
        webhookSecretEnvFilePath,
        subdomain,
        webhookEndpointId: created.endpointId,
        webhookIntentRef: intentRef,
        webhookIntentFilePath,
      };
    },

    async deleteWebhookEndpoint(prep, secretKey) {
      await deleteWebhookEndpointById(secretKey, prep.webhookEndpointId, http);
      await removeWebhookIntentFile(prep.webhookIntentFilePath);
    },

    async buildWorld(inputs, prep) {
      // Every world-owned file lives under the SCOPED dir (prep.scopedRunDir), so
      // the world's run_directory cleanup only removes the scoped subtree — never
      // the parent's builder artifacts/candidate map.
      const secretsDir = path.join(prep.scopedRunDir, "secrets");
      await mkdir(secretsDir, { recursive: true });
      const e2bSecretsPath = await writeSecretEnvFile(secretsDir, "e2b.env", { E2B_API_KEY: inputs.e2bApiKey });
      // #1318 / base-world repair: #1257's six-field github_app_configured gate now
      // requires GITHUB_APP_WEBHOOK_SECRET, else the repo-authority gate 503s inside
      // the sandbox bootstrap's best-effort preclone and the covered repo never
      // materializes. Qualification exercises no inbound App webhook, so a run-scoped
      // random value satisfies the gate and is never verified against a delivery
      // (same rationale + fix as cloud-provision-1.ts's buildWorld).
      const githubSecretsPath = await writeSecretEnvFile(secretsDir, "github-app.env", {
        GITHUB_APP_CLIENT_SECRET: inputs.github.clientSecret,
        GITHUB_APP_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
      });
      const githubPrivateKeyPath = path.join(secretsDir, "github-app-private-key.pem");
      await writeFile(githubPrivateKeyPath, `${inputs.github.privateKey.trimEnd()}\n`, { mode: 0o600 });

      const publicOrigin = `https://${prep.subdomain}`;
      const stripe: CandidateStripeConfig = {
        secretsEnvFilePath: prep.secretsEnvFilePath,
        webhookSecretEnvFilePath: prep.webhookSecretEnvFilePath,
        checkoutSuccessUrl: publicOrigin,
        checkoutCancelUrl: publicOrigin,
      };

      const templateCustodyMode = process.env.RELEASE_E2E_SHARED_TEMPLATE_CUSTODY ?? "world_owned";
      if (templateCustodyMode !== "world_owned" && templateCustodyMode !== "consumer") {
        throw new Error(
          `MANAGED-CLOUD-FIXTURE-SMOKE-1 does not accept shared-template custody mode ${templateCustodyMode}.`,
        );
      }
      const options: ConstructManagedCloudWorldOptions = {
        run: inputs.run,
        map: inputs.map,
        litellm: inputs.litellm,
        aws: inputs.aws,
        e2b: {
          teamId: inputs.e2bTeamId,
          secretsEnvFilePath: e2bSecretsPath,
          templateName: `proliferate-runtime-qual-${inputs.run.run_id}`,
        },
        github: {
          appSlug: "proliferate-cloud-staging",
          appId: inputs.github.appId,
          clientId: inputs.github.clientId,
          installationId: inputs.github.installationId,
          secretsEnvFilePath: githubSecretsPath,
          privateKeyPemPath: githubPrivateKeyPath,
        },
        // PR-6 append-only options: stage Stripe + the on-box signed-callback relay
        // (default port). Both feed deployCandidateApi verbatim.
        stripe,
        callbackRelay: {},
        // SCOPED: the world's run_directory cleanup removes only this subdir, so
        // it never deletes the shared parent run dir's builder artifacts. The
        // copied sidecar under here lets the constructor's readBuildSubdomain read
        // the exact build subdomain (matching the renderer's baked-in value).
        tls: inputs.tls,
        runDir: prep.scopedRunDir,
        templateCustody:
          templateCustodyMode === "consumer"
            ? { mode: "shared_consumer", journalPath: sharedTemplateCustodyPath(inputs.runDir) }
            : { mode: "world_owned" },
        log: (message) => process.stderr.write(`[managed-cloud] ${message}\n`),
      };
      return constructWorld(options);
    },

    async adoptWebhookIntent(world, prep, secretKey) {
      // Register the pre-created endpoint into the world's ledger, then immediately
      // markAcquired with the real we_ id so world.close() deletes it. This is the
      // handoff from the scenario-owned intent file to the durable world ledger.
      // The releaser closes over `secretKey` (in-process, never serialized) +
      // `http`, deleting the endpoint by its real id (idempotent / tolerant of a
      // prior cell-E replay delete).
      const release = async (): Promise<void> => {
        const { deleteWebhookEndpointById } = await import("../fixtures/stripe-smoke-resources.js");
        await deleteWebhookEndpointById(secretKey, prep.webhookEndpointId, http);
      };
      if (!world.registerCleanupIntent) {
        await world.registerCleanup?.("stripe_webhook_endpoint", prep.webhookEndpointId, release);
        await removeWebhookIntentFile(prep.webhookIntentFilePath);
        return;
      }
      const handle = await world.registerCleanupIntent(
        "stripe_webhook_endpoint",
        prep.webhookIntentRef,
        release,
      );
      await handle.markAcquired(prep.webhookEndpointId);
      await removeWebhookIntentFile(prep.webhookIntentFilePath);
    },

    async createActor(world) {
      return authenticatedActor(asAuthenticatedActorWorld(world), "owner", {
        gatewaySurface: "cloud",
        beginActorEnrollmentCustody: (params) => {
          if (!world.beginActorEnrollmentCustody) {
            throw new Error("managed-cloud world exposes no pre-creation LiteLLM enrollment custody.");
          }
          return world.beginActorEnrollmentCustody(params);
        },
      });
    },
    async trackActorSubjects(world, actor) {
      await world.trackActorSubjects?.(actor.gatewayKey);
    },
    async runCallbackRelayCell(world, state) {
      return runCallbackRelayCellLive(world, state, http);
    },
    async runStripeTestClockCell(world, state) {
      const actor = await ensureOwnerActor(world, state, this);
      return runStripeTestClockCellLive(world, state, actor, http);
    },
    async runBillingThresholdCell(world, state) {
      const actor = await ensureOwnerActor(world, state, this);
      return runBillingThresholdCellLive(world, state, actor, productionBillingThresholdCellDeps);
    },
    async runFailureInjectionCell(world, state) {
      const actor = await ensureOwnerActor(world, state, this);
      return runFailureInjectionCellLive(world, state, actor);
    },
    async runCleanupReplayCell(world, state, closeWorld) {
      return runCleanupReplayCellLive(world, state, closeWorld, http, replayFixturesFresh);
    },
    async closeWorld(world) {
      return world.close();
    },
  };
}

export const defaultFixtureSmokeDriver: FixtureSmokeDriver = createFixtureSmokeDriver();

// ---------------------------------------------------------------------------
// Live cell bodies. These drive REAL fixtures/providers; they are exercised
// only in the live smoke (Actions), never offline (the driver seam is faked in
// unit tests). Kept faithful to the frozen spec's per-cell contract.
// ---------------------------------------------------------------------------

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Pure, exported parsers/builders (unit-tested over fake stat/proc/receipt
// outputs). No I/O — the live cells feed them raw box-exec stdout.
// ---------------------------------------------------------------------------

/** Absolute relay dir on the box (mirrors callback-relay.ts's private relayDir). */
export function relayDirOnBox(): string {
  return `${REMOTE_WORKDIR}/${RELAY_DIRNAME}`;
}

/** Parses `stat -c '%n %a'` lines into a path→octal-mode map. */
export function parseStatModes(stdout: string): Record<string, string> {
  const modes: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const idx = trimmed.lastIndexOf(" ");
    if (idx <= 0) {
      continue;
    }
    modes[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return modes;
}

/** The relay pidfile shape (`{pid,starttime,script}`), parsed from its JSON text. */
export interface RelayPidfile {
  pid: number;
  starttime: string;
  script: string;
}

export function parseRelayPidfileJson(text: string): RelayPidfile {
  const parsed = JSON.parse(text) as { pid?: unknown; starttime?: unknown; script?: unknown };
  if (
    typeof parsed.pid !== "number" ||
    typeof parsed.starttime !== "string" ||
    typeof parsed.script !== "string"
  ) {
    throw new Error("callback-relay: relay pidfile is malformed (expected {pid,starttime,script}).");
  }
  return { pid: parsed.pid, starttime: parsed.starttime, script: parsed.script };
}

/**
 * Recomputes `/proc/<pid>/stat` starttime (field 22 overall; field 20 of the
 * remainder AFTER the `) ` that closes the comm field — mirrors ingress.ts's own
 * start-time extraction so a comm containing spaces/parens never shifts fields).
 * Returns null when unparseable.
 */
export function parseProcStatStarttime(statLine: string): string | null {
  const afterComm = statLine.replace(/^.*\)\s+/, "");
  const fields = afterComm.trim().split(/\s+/);
  // fields[0] is state (field 3 overall); starttime is field 22 overall = index 19 here.
  const starttime = fields[19];
  return starttime && /^\d+$/.test(starttime) ? starttime : null;
}

/** Whether `/proc/<pid>/cmdline` (NUL-joined → we pass it space-joined) names the script path. */
export function procCmdlineContainsScript(cmdline: string, scriptPath: string): boolean {
  return cmdline.includes(scriptPath);
}

/** One webhook_event_receipt row shape, parsed from the serverPython JSON line. */
export interface WebhookReceiptSnapshot {
  count: number;
  status: string | null;
  attemptCount: number | null;
  processedAt: string | null;
}

export function parseWebhookReceiptSnapshot(stdout: string): WebhookReceiptSnapshot {
  const parsed = parseLastJsonLine(stdout) as {
    count?: unknown;
    status?: unknown;
    attempt_count?: unknown;
    processed_at?: unknown;
  };
  return {
    count: typeof parsed.count === "number" ? parsed.count : 0,
    status: typeof parsed.status === "string" ? parsed.status : null,
    attemptCount: typeof parsed.attempt_count === "number" ? parsed.attempt_count : null,
    processedAt: typeof parsed.processed_at === "string" ? parsed.processed_at : null,
  };
}

/**
 * Builds the on-box python3 command that re-POSTs a HELD-then-replayed
 * delivery's EXACT preserved bytes + headers (from `<relayDir>/replayed/<id>.bin`
 * + `.headers.json`) to the relay's loopback stripe path — the real duplicate
 * delivery. Skips the `Host` header (the relay's own `_forward` skip set), so
 * the signature header rides untouched. Runs entirely on the box: no byte
 * content crosses to the controller. Prints the upstream HTTP status as the
 * last line for the caller to read. Pure string builder (no I/O).
 */
export function buildDuplicatePostScript(
  relayDir: string,
  deliveryId: string,
  port: number,
  loopbackPath: string,
): string {
  // The bytes/headers are read from the replayed spool by the on-box python; the
  // deliveryId is a hex token (validated by the relay controller) so it is safe
  // to interpolate into the literal.
  const py = [
    "import json,sys,urllib.request",
    `d=${JSON.stringify(relayDir)}+"/replayed/"+${JSON.stringify(deliveryId)}`,
    'body=open(d+".bin","rb").read()',
    'hdrs=json.load(open(d+".headers.json"))',
    `req=urllib.request.Request("http://127.0.0.1:${port}${loopbackPath}",data=body,method="POST")`,
    'for k,v in hdrs:\n    if k.lower()=="host":\n        continue\n    req.add_header(k,v)',
    "try:\n    r=urllib.request.urlopen(req,timeout=30)\n    print(r.status)\nexcept urllib.error.HTTPError as e:\n    print(e.code)",
  ].join("\n");
  return `python3 -c ${shellSingleQuoteScenario(py)}`;
}

/** Single-quote a value for POSIX sh interpolation (mirrors box-exec.ts). */
function shellSingleQuoteScenario(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The candidate box serverPython that reads a webhook_event_receipt snapshot for
 * one (provider, event_id) — the real idempotency witness. Returns the row count,
 * status, attempt_count, and processed_at; never a payload/signature.
 */
const WEBHOOK_RECEIPT_SNAPSHOT_PY = `import asyncio, json, os
from sqlalchemy import func, select
from proliferate.db.engine import async_session_factory
from proliferate.db.models.billing import WebhookEventReceipt

EVENT_ID = os.environ["SEED_EVENT_ID"]
PROVIDER = os.environ.get("SEED_PROVIDER", "stripe")

async def main():
    async with async_session_factory() as db:
        rows = (
            await db.execute(
                select(WebhookEventReceipt).where(
                    WebhookEventReceipt.provider == PROVIDER,
                    WebhookEventReceipt.event_id == EVENT_ID,
                )
            )
        ).scalars().all()
        first = rows[0] if rows else None
        print(json.dumps({
            "count": len(rows),
            "status": first.status if first else None,
            "attempt_count": int(first.attempt_count) if first else None,
            "processed_at": first.processed_at.isoformat() if (first and first.processed_at) else None,
        }))

asyncio.run(main())
`;

/** Reads a webhook_event_receipt snapshot via the box-exec seam. */
async function readWebhookReceiptSnapshot(
  box: BoxExec,
  eventId: string,
): Promise<WebhookReceiptSnapshot> {
  const result = await box.serverPython(WEBHOOK_RECEIPT_SNAPSHOT_PY, {
    env: { SEED_EVENT_ID: eventId, SEED_PROVIDER: "stripe" },
    scriptName: "read-webhook-receipt.py",
  });
  return parseWebhookReceiptSnapshot(result.stdout);
}

/** Persists Cell A's customer intent before Stripe accepts the create. */
export async function createCellACustomerWithCustody(
  world: ManagedCloudWorld,
  state: { secretKey: string; runTag: string },
  http: StripeHttp,
): Promise<string> {
  if (!world.registerCleanupIntent) {
    throw new Error(
      "callback-relay: the managed-cloud world exposes no durable cleanup-intent seam for the Stripe customer.",
    );
  }

  let acceptedCustomerId: string | null = null;
  const handle = await world.registerCleanupIntent(
    "stripe_customer",
    `intent:customer:runTag=${state.runTag}:cellA`,
    async () => {
      if (acceptedCustomerId) {
        await deleteCustomerByIdHttp(state.secretKey, acceptedCustomerId, http);
        return;
      }
      await deleteRunCustomersByTag(
        { secretKey: state.secretKey, runTag: state.runTag, cellTag: "cellA" },
        http,
      );
    },
  );
  const created = await createRunCustomer(
    { secretKey: state.secretKey, runTag: state.runTag, cellTag: "cellA" },
    http,
  );
  acceptedCustomerId = created.customerId;
  await handle.markAcquired(created.customerId);
  return created.customerId;
}

/** Cell A — callback relay (spec Cell A). */
async function runCallbackRelayCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  http: StripeHttp,
): Promise<FixtureSmokeCellResult> {
  const { findEventForObject } = await import("../fixtures/stripe-smoke-resources.js");
  if (!world.box) {
    throw new Error("callback-relay: the managed-cloud world exposes no box-exec seam.");
  }
  const box = world.box;
  const relay: CallbackRelay = callbackRelay(world);
  const relayDir = relayDirOnBox();
  const relayPort = CALLBACK_RELAY_DEFAULT_PORT;
  const stripePath = "/v1/billing/webhooks/stripe";
  await relay.manifest("stripe"); // baseline read
  await relay.hold("stripe");

  // Cheapest real test-mode op firing a subscribed event. The durable cleanup
  // intent is persisted before POST and promoted to the accepted cus_ id
  // immediately after Stripe returns.
  const customerId = await createCellACustomerWithCustody(world, state, http);

  // Correlate the customer.created event id for our customer.
  const evt = await pollUntil(
    () => findEventForObject({ secretKey: state.secretKey, type: "customer.created", matchObjectId: customerId }, http),
    (v) => v !== null,
    CALLBACK_POLL_TIMEOUT_MS,
    CALLBACK_POLL_INTERVAL_MS,
  );
  if (!evt) {
    throw new Error("callback-relay: no customer.created event materialized for our customer within the poll window.");
  }

  // Poll the manifest for a held delivery whose providerEventId matches evt.id.
  const held = await pollUntil(
    async () => (await relay.manifest("stripe")).find((row) => row.providerEventId === evt.id) ?? null,
    (v) => v !== null,
    CALLBACK_POLL_TIMEOUT_MS,
    CALLBACK_POLL_INTERVAL_MS,
  );
  if (!held) {
    throw new Error(`callback-relay: no held delivery matched event ${evt.id} within the poll window.`);
  }

  // ── Spool file-mode proofs (0700 dir, 0600 files), BEFORE replay moves them. ──
  const heldStat = await box.exec(
    `stat -c '%n %a' ${shellSingleQuoteScenario(relayDir)} ` +
      `${shellSingleQuoteScenario(`${relayDir}/held/${held.deliveryId}.bin`)} ` +
      `${shellSingleQuoteScenario(`${relayDir}/held/${held.deliveryId}.headers.json`)}`,
  );
  const heldModes = parseStatModes(heldStat.stdout);
  const dirMode = heldModes[relayDir];
  const binMode = heldModes[`${relayDir}/held/${held.deliveryId}.bin`];
  const headersMode = heldModes[`${relayDir}/held/${held.deliveryId}.headers.json`];
  if (dirMode !== "700") {
    throw new Error(`callback-relay: relay spool dir mode is ${dirMode ?? "unknown"}, expected 700.`);
  }
  if (binMode !== "600" || headersMode !== "600") {
    throw new Error(
      `callback-relay: held spool file modes are bin=${binMode ?? "?"} headers=${headersMode ?? "?"}, expected 600.`,
    );
  }

  // ── PID/start-time/executable ownership proof: the pidfile discriminator must
  // match the live process, so the cleanup releaser cannot signal a reused pid. ──
  const pidfileText = await box.exec(`cat ${shellSingleQuoteScenario(`${relayDir}/relay.pid`)}`);
  const pidfile = parseRelayPidfileJson(pidfileText.stdout);
  const liveStat = await box.exec(`cat /proc/${pidfile.pid}/stat`);
  const liveStarttime = parseProcStatStarttime(liveStat.stdout);
  if (liveStarttime === null || liveStarttime !== pidfile.starttime) {
    throw new Error(
      `callback-relay: relay pidfile starttime (${pidfile.starttime}) does not match live /proc/${pidfile.pid}/stat ` +
        `(${liveStarttime ?? "unreadable"}) — the recorded pid is not the running relay (reuse hazard).`,
    );
  }
  const liveCmdline = await box.exec(`tr '\\0' ' ' < /proc/${pidfile.pid}/cmdline`);
  if (!procCmdlineContainsScript(liveCmdline.stdout, pidfile.script)) {
    throw new Error(
      `callback-relay: live /proc/${pidfile.pid}/cmdline does not contain the relay script path ${pidfile.script}.`,
    );
  }

  // ── First replay: forwarded byte-for-byte to the real verifying Server. ──
  await relay.replay(held.deliveryId);
  // The Server verified the HMAC (signature intact end-to-end) and processed the
  // event exactly once → its webhook_event_receipt row is 'processed'.
  const afterFirst = await pollUntil(
    () => readWebhookReceiptSnapshot(box, evt.id),
    (snap) => snap.count === 1 && snap.status === "processed",
    CALLBACK_POLL_TIMEOUT_MS,
    CALLBACK_POLL_INTERVAL_MS,
  );
  if (afterFirst.count !== 1 || afterFirst.status !== "processed") {
    throw new Error(
      `callback-relay: after the first replay the server webhook_event_receipt for ${evt.id} is ` +
        `count=${afterFirst.count} status=${afterFirst.status ?? "none"} (expected exactly one 'processed').`,
    );
  }

  // ── Duplicate delivery: re-POST the PRESERVED exact bytes+headers from the
  // replayed spool through the relay loopback (channel back to pass-through
  // first). Proves REAL idempotency — no re-dispatch — on the SERVER. ──
  await relay.release("stripe");
  const manifestBeforeDuplicate = await relay.manifest("stripe");
  const dupStatus = await box.exec(buildDuplicatePostScript(relayDir, held.deliveryId, relayPort, stripePath));
  const dupCode = Number.parseInt(dupStatus.stdout.trim().split("\n").pop() ?? "", 10);
  if (!(dupCode >= 200 && dupCode < 300)) {
    throw new Error(`callback-relay: the duplicate delivery POST returned ${dupCode} (expected a 2xx ack).`);
  }

  // Idempotency witness on the SERVER: still exactly one row, still 'processed',
  // and processed_at UNCHANGED (no re-dispatch of the already-processed event).
  const afterDuplicate = await readWebhookReceiptSnapshot(box, evt.id);
  if (afterDuplicate.count !== 1 || afterDuplicate.status !== "processed") {
    throw new Error(
      `callback-relay: after the duplicate delivery the server has count=${afterDuplicate.count} ` +
        `status=${afterDuplicate.status ?? "none"} (expected the SAME single 'processed' row — re-dispatch detected).`,
    );
  }
  if (afterDuplicate.processedAt !== afterFirst.processedAt) {
    throw new Error(
      `callback-relay: webhook_event_receipt.processed_at changed across the duplicate delivery ` +
        `(${afterFirst.processedAt} → ${afterDuplicate.processedAt}) — the event was re-dispatched.`,
    );
  }

  // Byte-identity witness: the duplicate produced a NEW forwarded manifest row
  // with the IDENTICAL bytesSha256 (the relay forwarded the exact bytes verbatim).
  const manifestAfterDuplicate = await pollUntil(
    () => relay.manifest("stripe"),
    (rows) => rows.filter((r) => r.providerEventId === evt.id).length > manifestBeforeDuplicate.filter((r) => r.providerEventId === evt.id).length,
    CALLBACK_POLL_TIMEOUT_MS,
    CALLBACK_POLL_INTERVAL_MS,
  );
  const witness = assertDuplicateDeliveryByteIdentity(manifestBeforeDuplicate, manifestAfterDuplicate, evt.id);

  return {
    externalIds: [customerId, evt.id, held.deliveryId],
    observedTransition:
      `held→replayed:processed→duplicate:${dupCode}:already_processed(processed_at_unchanged)→` +
      `byte_identical(${witness.bytesSha256.slice(0, 12)})[dir=700,files=600,pid_owned]`,
    cleanupEntries: ["stripe_customer", "callback_relay_spool"],
  };
}

/** Cell B — Stripe test clock (spec Cell B). Uses the ONE shared owner actor. */
async function runStripeTestClockCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  actor: AuthenticatedActor,
  http: StripeHttp,
): Promise<FixtureSmokeCellResult> {
  const smoke = await import("../fixtures/stripe-smoke-resources.js");
  const clockFixture = await import("../fixtures/stripe-test-clock.js");

  // Run-scoped product + price, registered-before-create under stripe_product_price.
  let productId = "";
  let priceId = "";
  if (world.registerCleanupIntent) {
    const handle = await world.registerCleanupIntent(
      "stripe_product_price",
      smoke.encodeProductPriceIntentRef(state.runTag),
      async () => {
        if (productId && priceId) {
          await smoke.deactivateProductPriceById(state.secretKey, productId, priceId, http);
        } else {
          await smoke.deactivateRunProductPricesByTag(
            { secretKey: state.secretKey, runTag: state.runTag },
            http,
          );
        }
      },
    );
    const created = await smoke.createRunProductPrice({ secretKey: state.secretKey, runTag: state.runTag }, http);
    productId = created.productId;
    priceId = created.priceId;
    await handle.markAcquired(smoke.encodeProductPriceProviderId(productId, priceId));
  } else {
    const created = await smoke.createRunProductPrice({ secretKey: state.secretKey, runTag: state.runTag }, http);
    productId = created.productId;
    priceId = created.priceId;
  }

  const handle = await clockFixture.stripeTestClockActor(world, actor, { secretKey: state.secretKey, priceId });

  // Advance, then wait for the clock to settle (advance is async) before polling
  // for the renewal event.
  await handle.advanceToNextPeriod();
  const clockReady = await pollUntil(
    () => smoke.getTestClockStatus({ secretKey: state.secretKey, testClockId: handle.testClockId }, http),
    (v) => "status" in v && v.status === "ready",
    CLOCK_READY_TIMEOUT_MS,
    CLOCK_READY_INTERVAL_MS,
  );
  if (!("status" in clockReady) || clockReady.status !== "ready") {
    throw new Error(
      `stripe-test-clock: test clock did not return to ready after advance (observed ${JSON.stringify(clockReady)}).`,
    );
  }
  const renewal = await pollUntil(
    () =>
      smoke.findRenewalEventForCustomer(
        {
          secretKey: state.secretKey,
          types: ["invoice.paid", "invoice.payment_succeeded"],
          matchCustomerId: handle.customerId,
        },
        http,
      ),
    (v) => v !== null,
    RENEWAL_EVENT_TIMEOUT_MS,
    CLOCK_READY_INTERVAL_MS,
  );
  if (!renewal) {
    throw new Error("stripe-test-clock: no renewal invoice event observed after advancing the test clock.");
  }

  // Interruption recovery: DISCARD the handle (no release()); rebuild replay
  // handlers from the RELOADED ledger and actually execute them. The proof must
  // not delete through the original in-memory controller.
  const ledger = await loadCleanupLedger(world.paths.runDir);
  const handlers = clockFixture.stripeCleanupReplayHandlers({
    secretKey: state.secretKey,
    ledgerEntries: ledger.entries(),
  });
  const clockName = clockFixture.clockNameForRun(state.runTag);
  const foundClock = await clockFixture.defaultStripeTestClockTransport.findTestClockByName({
    secretKey: state.secretKey,
    name: clockName,
  });
  if (foundClock?.testClockId !== handle.testClockId) {
    throw new Error("stripe-test-clock: recovery by run-scoped name did not locate our test clock.");
  }
  const foundCustomer = await clockFixture.defaultStripeTestClockTransport.findCustomerOnClock({
    secretKey: state.secretKey,
    testClockId: handle.testClockId,
    runTag: state.runTag,
  });
  if (foundCustomer?.customerId !== handle.customerId) {
    throw new Error("stripe-test-clock: recovery by runTag did not locate our customer on the clock.");
  }
  const clockEntries = ledger.unreconciled().filter(
    (entry) =>
      (entry.kind === "stripe_test_clock" && entry.providerId === handle.testClockId) ||
      (entry.kind === "stripe_customer" && entry.providerId === handle.customerId),
  );
  if (
    !clockEntries.some((entry) => entry.kind === "stripe_test_clock") ||
    !clockEntries.some((entry) => entry.kind === "stripe_customer")
  ) {
    throw new Error("stripe-test-clock: reloaded ledger did not retain both acquired clock/customer identities.");
  }
  // Execute only the reconstructed handlers here, without marking the durable
  // entries reconciled. This proves identity-based deletion while deliberately
  // leaving the entries for Cell E's independent fresh-process replay.
  for (const entry of clockEntries) {
    const handler = handlers[entry.kind];
    if (!handler) {
      throw new Error(`stripe-test-clock: no reconstructed cleanup handler for ${entry.kind}.`);
    }
    await handler(entry);
  }
  const afterReplay = await loadCleanupLedger(world.paths.runDir);
  const unreconciledClockEntries = afterReplay
    .entries()
    .filter(
      (entry) =>
        ((entry.kind === "stripe_test_clock" && entry.providerId === handle.testClockId) ||
          (entry.kind === "stripe_customer" && entry.providerId === handle.customerId)) &&
        entry.phase !== "reconciled",
    );
  if (unreconciledClockEntries.length !== clockEntries.length) {
    throw new Error(
      "stripe-test-clock: reconstructed handler execution unexpectedly reconciled durable entries before " +
        "Cell E's fresh-process replay.",
    );
  }

  // Verify the replay-driven delete, not an in-memory handle delete.
  const afterDelete = await smoke.getTestClockStatus({ secretKey: state.secretKey, testClockId: handle.testClockId }, http);
  if (!("missing" in afterDelete)) {
    throw new Error("stripe-test-clock: the test clock still resolves after deletion (expected resource_missing).");
  }
  // DELIBERATE double-release path: we do NOT reconcile the clock+customer ledger
  // entries here. Their world-close releasers (and cell E's replay handlers) run
  // again later — that is safe by design: deleteClock/deleteCustomer tolerate
  // resource_missing (Stripe's clock delete cascades its customers), so a second
  // release of an already-deleted resource is a clean no-op, not a failure.

  // Fail-closed live-mode assertion (local guard; no network).
  let liveThrew = false;
  try {
    clockFixture.resolveTestModeSecretKey("sk_live_x", {});
  } catch {
    liveThrew = true;
  }
  if (!liveThrew) {
    throw new Error("stripe-test-clock: resolveTestModeSecretKey did not reject a live-mode key (fail-closed broken).");
  }

  return {
    externalIds: [handle.testClockId, handle.customerId, handle.subscriptionId, renewal.id],
    observedTransition: "created→advanced→event_observed→recovered_by_identity→deleted_absent",
    cleanupEntries: ["stripe_test_clock", "stripe_customer", "stripe_product_price"],
  };
}

// ---------------------------------------------------------------------------
// Cell C — billing threshold. Its privileged sub-steps sit behind an injectable
// deps seam so the full spec arc (original→positioned→crossed→gated→restored)
// is unit-testable offline with fakes, while production wires the real on-box
// crypto/gateway/reconcile/read operations.
// ---------------------------------------------------------------------------

/** A product-side gate signal observed after the threshold is crossed. */
export type BillingGateSignal = "second_request_rejected" | "budget_status_exhausted";

/** Stable product error code emitted when managed LLM credit is exhausted. */
export const PRODUCT_LLM_CREDIT_DENIAL_CODE = "agent_gateway_credits_exhausted";

export interface BillingGatewayResponse {
  status: number;
  completionTokens: number;
  costUsd: number | null;
  /** Exact product classification only; generic HTTP statuses stay unclassified. */
  denialCode: typeof PRODUCT_LLM_CREDIT_DENIAL_CODE | null;
}

export interface BillingThresholdCellDeps {
  /** Positions the LLM ledger to `balance` (the merged billingThreshold fixture). */
  positionThreshold(
    world: ManagedCloudWorld,
    actor: AuthenticatedActor,
    balance: number,
  ): Promise<{ billingSubjectId: string; effectiveRemainder: number }>;
  /** Resolves (idempotently, no grant mutation) the actor's personal billing subject id. */
  resolveBillingSubjectId(world: ManagedCloudWorld, userId: string): Promise<string>;
  /** Reads the actor's current remaining LLM credit (USD) on the candidate box. */
  readRemainingCreditUsd(world: ManagedCloudWorld, billingSubjectId: string): Promise<number>;
  /**
   * Decrypts the actor's RAW scoped LiteLLM virtual key from the enrollment row
   * (never logged/serialized). Mirrors cloud-provision-1's DECRYPT_RUNTIME_TOKEN_PY
   * discipline: the raw key returns in-memory only.
   */
  decryptVirtualKey(world: ManagedCloudWorld, enrollmentId: string): Promise<string>;
  /** The gateway's eligible model ids (allowlist ∩ live), for cheapest selection. */
  listGatewayModels(world: ManagedCloudWorld): Promise<{ allowlist: string[]; live: string[] }>;
  /**
   * ONE real chat-completion against the PUBLIC gateway URL with the raw key.
   * Returns the HTTP status, the completion-token count (to prove the request
   * actually produced output — a 2xx with zero completion tokens is a failed
   * turn), and the request's cost (USD) if the response carries it (else null —
   * cost is then read from the ledger delta). The key never appears in a thrown
   * error/log.
   */
  gatewayChatCompletion(params: {
    world: ManagedCloudWorld;
    rawKey: string;
    modelId: string;
    maxTokens: number;
    prompt: string;
  }): Promise<BillingGatewayResponse>;
  /** Runs the product's accounting + reconcile passes on the candidate box. */
  runReconcilePasses(world: ManagedCloudWorld): Promise<void>;
  /**
   * Runs the product's LiteLLM spend-log IMPORTER on the candidate box
   * (`run_usage_import` — the debit-side ingest that writes agent_llm_usage_event
   * rows). run_billing_accounting_pass does NOT call this, so without it the real
   * gateway spend never reaches get_remaining_credit_usd and the ledger never
   * moves (the observed "total observed cost 0" red). Returns the imported-row
   * count for the bounded poll. LiteLLM spend logs lag a few seconds, so the
   * caller polls import+read.
   */
  runUsageImport(world: ManagedCloudWorld): Promise<{ imported: number }>;
  /** Reads the enrollment's budget_status on the candidate box. */
  readBudgetStatus(world: ManagedCloudWorld, enrollmentId: string): Promise<string>;
  /** Runs the durable restore-and-reload releaser NOW (world-close is then a no-op). */
  restoreAdjustment(world: ManagedCloudWorld, receiptFile: string): Promise<void>;
}

const READ_REMAINING_CREDIT_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.agent_gateway.credits import get_remaining_credit_usd

BILLING_SUBJECT_ID = UUID(os.environ["SEED_BILLING_SUBJECT_ID"])

async def main():
    async with async_session_factory() as db:
        balance = await get_remaining_credit_usd(db, BILLING_SUBJECT_ID)
        print(json.dumps({"remaining_usd": float(balance.remaining_usd)}))

asyncio.run(main())
`;

/**
 * Decrypts the enrollment's virtual key using the product's OWN store function
 * (`get_enrollment_virtual_key_decrypted` → `decrypt_text`). Prints ONLY
 * `{"key": ...}`; the caller parses it and never logs it (mirrors
 * cloud-provision-1's DECRYPT_RUNTIME_TOKEN_PY).
 */
const DECRYPT_VIRTUAL_KEY_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.agent_gateway.enrollments import get_enrollment_virtual_key_decrypted

ENROLLMENT_ID = UUID(os.environ["SEED_ENROLLMENT_ID"])

async def main():
    async with async_session_factory() as db:
        key = await get_enrollment_virtual_key_decrypted(db, enrollment_id=ENROLLMENT_ID)
        print(json.dumps({"key": key}))

asyncio.run(main())
`;

const READ_BUDGET_STATUS_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.models.cloud.agent_gateway import AgentGatewayEnrollment

ENROLLMENT_ID = UUID(os.environ["SEED_ENROLLMENT_ID"])

async def main():
    async with async_session_factory() as db:
        row = await db.get(AgentGatewayEnrollment, ENROLLMENT_ID)
        print(json.dumps({"budget_status": row.budget_status if row else None}))

asyncio.run(main())
`;

const RUN_RECONCILE_PASSES_PY = `import asyncio, json
from proliferate.server.billing.accounting_pass import run_billing_accounting_pass
from proliferate.server.billing.reconciler import run_billing_reconcile_pass

async def main():
    await run_billing_accounting_pass()
    await run_billing_reconcile_pass()
    print(json.dumps({"ran": True}))

asyncio.run(main())
`;

/**
 * Runs the product's LiteLLM spend-log importer (the debit-side ingest that
 * writes agent_llm_usage_event rows the credit balance subtracts). This is the
 * step run_billing_accounting_pass does NOT do — without it real gateway spend
 * never reaches get_remaining_credit_usd. Uses the same worker entry the
 * background loop calls (run_usage_import over its own transaction).
 */
const RUN_USAGE_IMPORT_PY = `import asyncio, json
from proliferate.server.cloud.agent_gateway.worker import run_usage_import_once

async def main():
    result = await run_usage_import_once()
    print(json.dumps({"imported": int(result.imported)}))

asyncio.run(main())
`;

const RESOLVE_BILLING_SUBJECT_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject

USER_ID = UUID(os.environ["SEED_USER_ID"])

async def main():
    async with async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, USER_ID)
        await db.commit()
        print(json.dumps({"billing_subject_id": str(subject.id)}))

asyncio.run(main())
`;

const productionBillingThresholdCellDeps: BillingThresholdCellDeps = {
  async positionThreshold(world, actor, balance) {
    const positioned = await billingThreshold(world, actor, { ledger: "llm", balance });
    return { billingSubjectId: positioned.billingSubjectId, effectiveRemainder: positioned.effectiveRemainder };
  },
  async resolveBillingSubjectId(world, userId) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to resolve the billing subject.");
    }
    const result = await world.box.serverPython(RESOLVE_BILLING_SUBJECT_PY, {
      env: { SEED_USER_ID: userId },
      scriptName: "resolve-billing-subject-cellc.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { billing_subject_id?: unknown };
    if (typeof parsed.billing_subject_id !== "string" || !parsed.billing_subject_id) {
      throw new Error(`billing-threshold: box did not report a billing subject id (${result.stdout.trim().slice(0, 200)}).`);
    }
    return parsed.billing_subject_id;
  },
  async readRemainingCreditUsd(world, billingSubjectId) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to read remaining credit.");
    }
    const result = await world.box.serverPython(READ_REMAINING_CREDIT_PY, {
      env: { SEED_BILLING_SUBJECT_ID: billingSubjectId },
      scriptName: "read-remaining-credit.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { remaining_usd?: unknown };
    if (typeof parsed.remaining_usd !== "number") {
      throw new Error(`billing-threshold: box did not report remaining credit (${result.stdout.trim().slice(0, 200)}).`);
    }
    return parsed.remaining_usd;
  },
  async decryptVirtualKey(world, enrollmentId) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to decrypt the virtual key.");
    }
    const result = await world.box.serverPython(DECRYPT_VIRTUAL_KEY_PY, {
      env: { SEED_ENROLLMENT_ID: enrollmentId },
      scriptName: "decrypt-virtual-key.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { key?: unknown };
    if (typeof parsed.key !== "string" || !parsed.key) {
      // Never echo the (absent) key material — only the failure shape.
      throw new Error("billing-threshold: the candidate box did not report a decryptable virtual key for this enrollment.");
    }
    return parsed.key;
  },
  async listGatewayModels(world) {
    const preflight = await world.gateway.preflight();
    return { allowlist: preflight.eligibleClaudeModels, live: preflight.eligibleClaudeModels };
  },
  async gatewayChatCompletion({ world, rawKey, modelId, maxTokens, prompt }) {
    // ONE real chat-completion to the PUBLIC gateway URL. The raw key rides only
    // in the Authorization header; it is never placed in a thrown error/log.
    const url = `${world.gateway.publicBaseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${rawKey}` },
        body: JSON.stringify({ model: modelId, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      // Transport failure — surface WITHOUT the key.
      throw new Error("billing-threshold: the gateway chat-completion request failed at the transport layer.");
    }
    let costUsd: number | null = null;
    const body = (await response.json().catch(() => ({}))) as {
      code?: unknown;
      detail?: { code?: unknown };
      error?: { code?: unknown };
      usage?: { cost?: unknown; total_cost?: unknown; completion_tokens?: unknown };
    };
    const cost = body.usage?.cost ?? body.usage?.total_cost;
    if (typeof cost === "number") {
      costUsd = cost;
    }
    const completionTokens =
      typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0;
    const observedCode = body.code ?? body.detail?.code ?? body.error?.code;
    const denialCode = observedCode === PRODUCT_LLM_CREDIT_DENIAL_CODE
      ? PRODUCT_LLM_CREDIT_DENIAL_CODE
      : null;
    return { status: response.status, completionTokens, costUsd, denialCode };
  },
  async runUsageImport(world) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to run the usage importer.");
    }
    const result = await world.box.serverPython(RUN_USAGE_IMPORT_PY, { scriptName: "run-usage-import.py" });
    const parsed = parseLastJsonLine(result.stdout) as { imported?: unknown };
    return { imported: typeof parsed.imported === "number" ? parsed.imported : 0 };
  },
  async runReconcilePasses(world) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to run reconcile passes.");
    }
    await world.box.serverPython(RUN_RECONCILE_PASSES_PY, { scriptName: "run-reconcile-passes.py" });
  },
  async readBudgetStatus(world, enrollmentId) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to read budget status.");
    }
    const result = await world.box.serverPython(READ_BUDGET_STATUS_PY, {
      env: { SEED_ENROLLMENT_ID: enrollmentId },
      scriptName: "read-budget-status.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { budget_status?: unknown };
    return typeof parsed.budget_status === "string" ? parsed.budget_status : "unknown";
  },
  async restoreAdjustment(world, receiptFile) {
    if (!world.box) {
      throw new Error("billing-threshold: no box-exec seam to restore the adjustment.");
    }
    await restoreBillingFixtureAdjustment(world.box, receiptFile);
  },
};

/** Epsilon for the restored-remainder assertion (llm ledger, USD). billingThreshold's llm epsilon is 1e-6. */
const BILLING_REMAINDER_EPSILON = 1e-6;
/**
 * Positioned balance: a SMALL positive amount (billingThreshold requires > 0;
 * its llm epsilon is 1e-6, so 0.0001 is comfortably positionable). Deliberately
 * below one cheapest-model 32-token request's cost so a single real request is
 * very likely to cross it — and the crossing LOOP below guarantees it regardless.
 */
const BILLING_POSITION_BALANCE = 0.0001;
/** Max identical bounded requests to issue while trying to cross the threshold. */
const BILLING_MAX_CROSSING_REQUESTS = 10;
/** Bounded import+reconcile+read poll per request — LiteLLM spend logs lag a few seconds. */
const BILLING_USAGE_IMPORT_POLL_TIMEOUT_MS = 60_000;
const BILLING_USAGE_IMPORT_POLL_INTERVAL_MS = 3_000;

/**
 * Cell C — billing threshold (frozen spec Cell C, all six obligations):
 * original→positioned→crossed(real usage)→gated(product consequence)→restored
 * (restore + reload the persisted ledger).
 *
 * The get_remaining_credit_usd formula is `sum(active grants) − sum(imported
 * usage)`. Restoration un-expires the prior grants and deletes the run-tagged
 * grant, so the grant side returns to its original total — BUT the real request's
 * imported usage row persists. So the correct restored remainder is
 * `originalRemaining − observedRequestCost` (NOT originalRemaining), asserted
 * within epsilon. Documented against the server formula (credits.py).
 */
export async function runBillingThresholdCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  actor: AuthenticatedActor,
  deps: BillingThresholdCellDeps = productionBillingThresholdCellDeps,
  // Bounded import+read poll timing; overridable so offline tests do not wait out
  // the production window.
  pollTiming: { timeoutMs: number; intervalMs: number } = {
    timeoutMs: BILLING_USAGE_IMPORT_POLL_TIMEOUT_MS,
    intervalMs: BILLING_USAGE_IMPORT_POLL_INTERVAL_MS,
  },
): Promise<FixtureSmokeCellResult> {
  // (a) Read the ORIGINAL remaining credit BEFORE positioning, so restoration can
  // be checked against it. The billing subject is the actor's deterministic
  // personal subject (billingThreshold uses ensure_personal_billing_subject), so
  // resolve it idempotently first (no grant mutation) and read its remainder.
  const preSubjectId = await deps.resolveBillingSubjectId(world, actor.userId);
  const originalRemaining = await deps.readRemainingCreditUsd(world, preSubjectId);
  // (b) Position a SMALL balance (0.0001, > 0 per the fixture; runs the product
  // accounting+reconcile passes and returns the OBSERVED remainder + subject id).
  const positioned = await deps.positionThreshold(world, actor, BILLING_POSITION_BALANCE);
  const billingSubjectId = positioned.billingSubjectId;

  // (c) Cause real usage: decrypt the actor's raw scoped key and issue real
  // gateway chat-completions with the cheapest eligible model until the ledger
  // crosses to <= 0. One cheapest-model 32-token request may cost less than the
  // positioned balance, so LOOP (max 10 identical bounded requests), running the
  // accounting+reconcile passes + re-reading remaining after each, until crossed
  // or the loop budget is exhausted (then fail with the observed per-request cost).
  const rawKey = await deps.decryptVirtualKey(world, actor.enrollmentId);
  const { allowlist, live } = await deps.listGatewayModels(world);
  const modelId = selectCheapestEligibleClaudeModel(allowlist, live);
  if (!modelId) {
    throw new Error("billing-threshold: no eligible cheapest Claude model to run the crossing request.");
  }

  // (d) Observe the product consequence: after the crossing, require (1) remaining
  // credit ≤ 0 AND (2) at least one gate signal — a SECOND request rejected
  // non-2xx, OR budget_status flipped to exhausted.
  //
  // The spend does NOT reach the credit ledger by itself: run_billing_accounting_pass
  // does not import LiteLLM spend logs. The importer is run_usage_import (the
  // debit-side ingest that writes agent_llm_usage_event rows). So after each real
  // request we run the importer + the reconcile passes and BOUNDED-poll the
  // remaining credit (LiteLLM spend logs lag a few seconds), mirroring how
  // CLOUD-PROVISION-1 polls LiteLLM spend for correlation.
  let totalObservedCost = 0;
  let requestsIssued = 0;
  let crossedRemaining = positioned.effectiveRemainder;
  for (let i = 0; i < BILLING_MAX_CROSSING_REQUESTS; i += 1) {
    const request = await deps.gatewayChatCompletion({
      world,
      rawKey,
      modelId,
      maxTokens: 32,
      prompt: "Reply with exactly the word: pong",
    });
    requestsIssued += 1;
    if (!(request.status >= 200 && request.status < 300)) {
      // A rejected request before crossing is itself the budget gate kicking in —
      // stop issuing (further requests would also be rejected) and let the
      // remaining-credit + gate-signal checks below interpret it.
      break;
    }
    // A 2xx with zero completion tokens is a FAILED turn (no real product usage),
    // not a success — fail loudly rather than looping against a no-op request.
    if (request.completionTokens <= 0) {
      throw new Error(
        `billing-threshold: gateway request #${requestsIssued} returned ${request.status} but zero completion ` +
          "tokens — the request produced no real usage (a silently-failing turn), so it cannot cross the threshold.",
      );
    }
    const beforeRead = crossedRemaining;
    // Import the LiteLLM spend → ledger, then reconcile; BOUNDED-poll because the
    // spend log lags a few seconds. Exit the poll as soon as THIS request's spend
    // has landed (remaining dropped below beforeRead) OR the ledger crossed — the
    // outer loop then decides whether another request is needed. (Polling for a
    // crossing alone would spin the full timeout on a request whose cost is fully
    // imported but not yet enough to cross.)
    crossedRemaining = await pollUntil(
      async () => {
        await deps.runUsageImport(world);
        await deps.runReconcilePasses(world);
        return deps.readRemainingCreditUsd(world, billingSubjectId);
      },
      (remaining) => remaining <= 0 || remaining < beforeRead,
      pollTiming.timeoutMs,
      pollTiming.intervalMs,
    );
    if (typeof request.costUsd === "number") {
      totalObservedCost += request.costUsd;
    } else {
      // No inline cost — infer this request's cost from the ledger delta.
      totalObservedCost += Math.max(0, beforeRead - crossedRemaining);
    }
    if (crossedRemaining <= 0) {
      break;
    }
  }
  if (crossedRemaining > 0) {
    throw new Error(
      `billing-threshold: remaining credit did not cross to <= 0 after ${requestsIssued} real request(s) ` +
        `(observed remaining ${crossedRemaining}, total observed cost ${totalObservedCost}). If the requests ` +
        "succeeded (2xx, nonzero completion tokens) but the ledger never moved, the LiteLLM usage import (" +
        "run_usage_import) is not landing spend rows; otherwise widen BILLING_MAX_CROSSING_REQUESTS.",
    );
  }
  const observedRequestCost = totalObservedCost;
  const gateSignals: BillingGateSignal[] = [];
  const secondRequest = await deps.gatewayChatCompletion({
    world,
    rawKey,
    modelId,
    maxTokens: 32,
    prompt: "Reply with exactly the word: pong",
  });
  if (
    !(secondRequest.status >= 200 && secondRequest.status < 300) &&
    secondRequest.denialCode === PRODUCT_LLM_CREDIT_DENIAL_CODE
  ) {
    gateSignals.push("second_request_rejected");
  }
  const budgetStatus = await deps.readBudgetStatus(world, actor.enrollmentId);
  if (budgetStatus === "exhausted" || budgetStatus === "limit_reached") {
    gateSignals.push("budget_status_exhausted");
  }
  if (gateSignals.length === 0) {
    throw new Error(
      "billing-threshold: crossed the ledger but observed NO classified product-side gate signal (the second " +
        `request was HTTP ${secondRequest.status} with denial_code=${secondRequest.denialCode ?? "none"}; ` +
        `budget_status=${budgetStatus}). Generic auth/rate-limit/server failures are not billing proof.`,
    );
  }

  // (e) Restore + reload: run the durable releaser NOW (world-close then no-ops).
  const receiptFile = billingThresholdReceiptFile(state.runTag, actor.userId, "llm");
  await deps.restoreAdjustment(world, receiptFile);
  const restoredRemaining = await deps.readRemainingCreditUsd(world, billingSubjectId);
  // Restoration returns the GRANT side to original; the real imported usage row
  // persists, so the correct restored remainder is originalRemaining − cost.
  const expectedRestored = originalRemaining - observedRequestCost;
  if (Math.abs(restoredRemaining - expectedRestored) > BILLING_REMAINDER_EPSILON) {
    throw new Error(
      `billing-threshold: restored remaining ${restoredRemaining} != expected ${expectedRestored} ` +
        `(originalRemaining ${originalRemaining} − observedRequestCost ${observedRequestCost}) within ${BILLING_REMAINDER_EPSILON}. ` +
        "Grants restored from the persisted receipt; imported usage persists by design (credits.py formula).",
    );
  }

  return {
    externalIds: [billingSubjectId],
    observedTransition:
      `original=${originalRemaining}→positioned=${positioned.effectiveRemainder}→` +
      `crossed=${crossedRemaining}(cost=${observedRequestCost})→gated:${gateSignals.join("+")}→` +
      `restored=${restoredRemaining}`,
    cleanupEntries: ["billing_fixture_adjustment"],
  };
}

const PROVIDER_BINDING_OBSERVATION_SCRIPT = `import asyncio, json, os, uuid
from sqlalchemy import select
from proliferate.db.engine import async_session_factory
from proliferate.db.models.cloud.sandboxes import CloudSandbox

async def main():
    sandbox_id = uuid.UUID(os.environ["CLOUD_SANDBOX_ID"])
    async with async_session_factory() as db:
        row = (await db.execute(select(CloudSandbox).where(CloudSandbox.id == sandbox_id))).scalar_one_or_none()
        if row is None:
            print(json.dumps({"status": "absent"}))
            return
        product_status = row.status.value if hasattr(row.status, "value") else str(row.status)
        print(json.dumps({
            "status": "found",
            "cloud_sandbox_id": str(row.id),
            "provider_sandbox_id": row.provider_sandbox_id,
            "product_status": product_status,
            "ready_at": row.ready_at.isoformat() if row.ready_at else None,
        }))

asyncio.run(main())
`;

export interface RuntimeReadinessFailureObservation {
  cloudSandboxId: string;
  providerSandboxId: string | null;
  status: string;
  readyAt: string | null;
}

async function observeProviderBindingOnBox(
  world: ManagedCloudWorld,
  cloudSandboxId: string,
): Promise<RuntimeReadinessFailureObservation | null> {
  if (!world.box) {
    throw new Error("failure-injection: the world exposes no candidate-box observation seam.");
  }
  const result = await world.box.serverPython(PROVIDER_BINDING_OBSERVATION_SCRIPT, {
    env: { CLOUD_SANDBOX_ID: cloudSandboxId },
    scriptName: "observe-provider-binding.py",
  });
  const parsed = parseLastJsonLine(result.stdout) as Record<string, unknown>;
  if (parsed.status === "absent") return null;
  if (
    parsed.status !== "found" ||
    parsed.cloud_sandbox_id !== cloudSandboxId ||
    typeof parsed.product_status !== "string" ||
    (typeof parsed.provider_sandbox_id !== "string" && parsed.provider_sandbox_id !== null) ||
    (typeof parsed.ready_at !== "string" && parsed.ready_at !== null)
  ) {
    throw new Error("failure-injection: candidate provider-binding observation was malformed.");
  }
  return {
    cloudSandboxId,
    providerSandboxId: parsed.provider_sandbox_id,
    status: parsed.product_status,
    readyAt: parsed.ready_at,
  };
}

export interface RuntimeReadinessRecoveryOps {
  prepareActor(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<void>;
  controlProductAction(actor: AuthenticatedActor): Promise<boolean>;
  ensureSandbox(actor: AuthenticatedActor): Promise<{ id: string }>;
  registerSandboxIntent(world: ManagedCloudWorld, cloudSandboxId: string): Promise<CleanupIntentHandle>;
  armRuntimeReadinessFailure(
    world: ManagedCloudWorld,
    params: { cloudSandboxId: string; operationId: string },
  ): Promise<{
    operationId: string;
    waitForInjection(): Promise<{
      providerSandboxId: string;
      handle: FailureInjectionHandle;
      observation: RuntimeReadinessFailureObservation;
    }>;
    disarm(): Promise<void>;
  }>;
  startProductMaterialization(actor: AuthenticatedActor): Promise<void>;
  waitForProvider(cloudSandboxId: string): Promise<string>;
  recoverSandbox(actor: AuthenticatedActor): Promise<void>;
  waitForMaterializationReady(actor: AuthenticatedActor): Promise<void>;
  relayManifestReadable(world: ManagedCloudWorld): Promise<boolean>;
}

interface JsonGetClient {
  get(path: string): Promise<unknown>;
}

/** Waits for the server's exact current personal-secret materialization result. */
export async function waitForPersonalMaterializationReady(
  client: JsonGetClient,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? FAILURE_RECOVERY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 2_000;
  const wait = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (true) {
    const payload = await client.get("/v1/cloud/secrets/personal");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("failure-injection: personal-secret materialization returned a malformed response.");
    }
    const materialization = (payload as Record<string, unknown>).materialization;
    if (materialization !== null && materialization !== undefined) {
      if (typeof materialization !== "object" || Array.isArray(materialization)) {
        throw new Error("failure-injection: personal-secret materialization returned a malformed state.");
      }
      const state = materialization as Record<string, unknown>;
      if (state.status === "ready") return;
      if (state.status === "error") {
        const detail = typeof state.lastError === "string" && state.lastError
          ? `: ${state.lastError}`
          : "";
        throw new Error(`failure-injection: personal-secret materialization failed${detail}`);
      }
      if (state.status !== "pending" && state.status !== "running") {
        throw new Error("failure-injection: personal-secret materialization returned an unknown status.");
      }
    }
    if (now() >= deadline) {
      throw new Error("failure-injection: personal-secret materialization did not reach ready within the bounded wait.");
    }
    await wait(pollMs);
  }
}

/** Registers Cell D sandbox custody and mirrors fresh-executor cleanup truth. */
export async function registerFailureInjectionSandboxIntent(
  world: ManagedCloudWorld,
  cloudSandboxId: string,
  deps: {
    find?: typeof findProviderSandbox;
    kill?: typeof killProviderSandbox;
  } = {},
): Promise<CleanupIntentHandle> {
  if (!world.registerCleanupIntent) {
    throw new Error(
      "failure-injection: the managed-cloud world exposes no durable sandbox cleanup-intent seam.",
    );
  }
  const find = deps.find ?? findProviderSandbox;
  const kill = deps.kill ?? killProviderSandbox;
  const knownProviderIds = new Set<string>();
  let custodyPublished = false;
  const handle = await world.registerCleanupIntent(
    "e2b_sandbox",
    encodeE2bSandboxCleanupIdentity({ cloudSandboxId, providerSandboxId: null }),
    async () => {
      const found = await find(cloudSandboxId);
      if (!Array.isArray(found.matches) || !Number.isSafeInteger(found.count) || found.count !== found.matches.length) {
        throw new Error("failure-injection: E2B cleanup inventory is not exhaustive.");
      }
      const matches = found.matches;
      if (matches.length === 0 && !custodyPublished) {
        // registerCleanupIntent has not returned, so its caller cannot start
        // the provider-creating product action. This is the only authoritative
        // in-memory no-provider crash window.
        return;
      }
      if (matches.length === 0 && knownProviderIds.size === 0) {
        throw new Error(
          "failure-injection: E2B sandbox intent has no authoritative provider binding; preserving cleanup custody.",
        );
      }
      const providerIds = new Set([
        ...knownProviderIds,
        ...matches.map((match) => match.providerSandboxId),
      ]);
      const sortedProviderIds = [...providerIds].sort();
      await handle.markAcquired(encodeE2bSandboxCleanupIdentity({
        cloudSandboxId,
        providerSandboxId: sortedProviderIds[0] ?? null,
        providerSandboxIds: sortedProviderIds.length > 1 ? sortedProviderIds : undefined,
      }));
      knownProviderIds.clear();
      for (const providerId of sortedProviderIds) knownProviderIds.add(providerId);
      for (const providerId of providerIds) {
        const killed = await kill(providerId);
        if (killed.killed !== true) {
          throw new Error(
            `failure-injection: E2B did not positively affirm cleanup of sandbox ${providerId}.`,
          );
        }
      }
      const remaining = await find(cloudSandboxId);
      if (
        !Array.isArray(remaining.matches) ||
        !Number.isSafeInteger(remaining.count) ||
        remaining.count !== remaining.matches.length
      ) {
        throw new Error("failure-injection: post-cleanup E2B inventory is not exhaustive.");
      }
      if (remaining.matches.length !== 0) {
        throw new Error(
          `failure-injection: E2B cleanup left ${remaining.matches.length} run-owned provider sandbox(es).`,
        );
      }
    },
  );
  custodyPublished = true;
  return {
    entryId: handle.entryId,
    async markAcquired(providerSandboxId) {
      await handle.markAcquired(encodeE2bSandboxCleanupIdentity({ cloudSandboxId, providerSandboxId }));
      knownProviderIds.add(providerSandboxId);
    },
  };
}

export function isInjectedRuntimeReadinessFailure(
  observation: RuntimeReadinessFailureObservation | null,
  expectedCloudSandboxId: string,
  expectedProviderId: string,
): observation is RuntimeReadinessFailureObservation {
  return (
    observation?.cloudSandboxId === expectedCloudSandboxId &&
    observation.providerSandboxId === expectedProviderId &&
    observation.status === "creating" &&
    observation.readyAt === null
  );
}

/** Cell D — exact runtime-readiness failure and normal-product recovery. */
export async function runFailureInjectionCellLive(
  world: ManagedCloudWorld,
  _state: SmokeState,
  actor: AuthenticatedActor,
  ops: RuntimeReadinessRecoveryOps = defaultRuntimeReadinessRecoveryOps,
): Promise<FixtureSmokeCellResult> {
  await ops.prepareActor(world, actor);
  if (!(await ops.controlProductAction(actor))) {
    throw new Error("failure-injection: the control product action did not succeed before injection.");
  }

  const first = await ops.ensureSandbox(actor);
  const cleanup = await ops.registerSandboxIntent(world, first.id);
  const operationId = `runtime-readiness:${world.run.run_id}:${world.run.shard_id}:${first.id}`;
  // Arm and prove a zero-provider baseline before the normal product action.
  // The watcher is scoped to this exact logical sandbox id + run operation, so
  // a pre-existing or later unrelated provider loss cannot satisfy the cell.
  const armed = await ops.armRuntimeReadinessFailure(world, { cloudSandboxId: first.id, operationId });
  // Trigger the real product materialization path only after durable recovery
  // identity AND the bounded provider watcher exist. The PUT schedules provider
  // creation; it is not a provider backdoor and does not wait for readiness.
  const firstAction = ops.startProductMaterialization(actor).catch(() => {
    // Attach the rejection handler immediately: provider failure is expected
    // during this cell, and waiting to attach `.catch()` until after the E2B
    // poll can otherwise surface a transient unhandled rejection.
  });
  let fired: {
    providerSandboxId: string;
    handle: FailureInjectionHandle;
    observation: RuntimeReadinessFailureObservation;
  };
  try {
    fired = await armed.waitForInjection();
    if (
      armed.operationId !== operationId ||
      fired.handle.boundary !== "runtime_readiness" ||
      !fired.handle.injected ||
      !isInjectedRuntimeReadinessFailure(fired.observation, first.id, fired.providerSandboxId)
    ) {
      throw new Error(
        "failure-injection: runtime_readiness did not prove exact AnyHarness present→absent before product readiness.",
      );
    }
  } finally {
    await armed.disarm();
  }
  const firstProviderId = fired.providerSandboxId;
  await cleanup.markAcquired(firstProviderId);
  // The scheduling request may resolve before the asynchronous process kill or
  // surface it itself. The watcher already proved exact process loss while the
  // product row remained non-ready.
  await firstAction;

  await ops.recoverSandbox(actor);
  const recoveredProviderId = await ops.waitForProvider(first.id);
  if (recoveredProviderId !== firstProviderId) {
    throw new Error("failure-injection: runtime recovery replaced the provider instead of relaunching AnyHarness in place.");
  }
  await cleanup.markAcquired(recoveredProviderId);

  // Re-run the same normal product action as an idempotency/control check. It
  // must stay on the recovered provider and prove the failure rule is disarmed.
  await ops.startProductMaterialization(actor);
  const controlProviderId = await ops.waitForProvider(first.id);
  if (controlProviderId !== recoveredProviderId) {
    throw new Error("failure-injection: the post-recovery control action changed provider identity.");
  }
  await ops.waitForMaterializationReady(actor);

  const controlAfter = await ops.controlProductAction(actor);
  const manifestReadable = await ops.relayManifestReadable(world);
  if (!controlAfter || !manifestReadable) {
    throw new Error(
      `failure-injection: recovery controls were not healthy (product=${controlAfter}, relay=${manifestReadable}).`,
    );
  }

  return {
    externalIds: [first.id, firstProviderId],
    observedTransition:
      "control_ok→provider_created→anyharness_present→anyharness_killed→product_stayed_non_ready→" +
      "normal_path_recovery→same_provider_ready→secret_materialization_ready→failure_rule_disarmed→controls_ok",
    cleanupEntries: ["e2b_sandbox"],
  };
}

const defaultRuntimeReadinessRecoveryOps: RuntimeReadinessRecoveryOps = {
  async prepareActor(world, actor) {
    if (!world.box) {
      throw new Error("failure-injection: the world exposes no candidate-box seam for qualification setup.");
    }
    await seedUnlimitedCloudEntitlementOnBox(world.box, actor.userId);
    const botSeed = await resolveBotSeedForAutomation();
    if (!botSeed) {
      throw new Error("failure-injection: the qualification GitHub refresh seed is unavailable.");
    }
    const seeded = await seedGithubAuthorizationOnBox({
      box: world.box,
      userId: actor.userId,
      clientId: botSeed.clientId,
      clientSecret: botSeed.clientSecret,
      refreshToken: botSeed.refreshToken,
      coveredRepoOwner: COVERED_REPO_OWNER,
      coveredRepoName: COVERED_REPO_NAME,
      coveredRepoDefaultBranch: COVERED_REPO_DEFAULT_BRANCH,
      // Cell D must make its normal product action the first provider-creating
      // operation, after durable cleanup intent + watcher arming.
      materializeSandbox: false,
      persistRotatedRefreshToken: (next) =>
        persistRotatedBotSeedDurable(
          {
            localSeedFilePath: botSeed.seedFilePath,
            source: botSeed.source,
            ssmParameterName: botSeed.ssmParameterName,
            region: botSeed.region,
          },
          next,
        ),
    });
    if (seeded.githubLogin !== EXPECTED_BOT_LOGIN) {
      throw new Error(`failure-injection: GitHub refresh seed resolved as unexpected login ${seeded.githubLogin}.`);
    }
  },
  controlProductAction: (actor) => actor.api.get("/v1/organizations").then(() => true).catch(() => false),
  ensureSandbox: (actor) => ensureCloudSandboxRow(actor.api),
  registerSandboxIntent: (world, cloudSandboxId) =>
    registerFailureInjectionSandboxIntent(world, cloudSandboxId),
  armRuntimeReadinessFailure: (world, params) => armRuntimeReadinessFailureWatcher(world, params),
  startProductMaterialization: async (actor) => {
    await actor.api.put("/v1/cloud/secrets/personal/env-vars/T3_FAILURE_INJECTION", {
      value: `${Date.now()}`,
    });
  },
  async waitForProvider(cloudSandboxId) {
    const deadline = Date.now() + FAILURE_RECOVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const found = await findProviderSandbox(cloudSandboxId);
      const matches = found.matches ?? (found.providerSandboxId ? [{ providerSandboxId: found.providerSandboxId }] : []);
      if (matches.length > 1) {
        throw new Error(`failure-injection: observed ${matches.length} live provider sandboxes for one logical row.`);
      }
      if (matches[0]?.providerSandboxId) {
        return matches[0].providerSandboxId;
      }
      await sleep(2_000);
    }
    throw new Error("failure-injection: no provider sandbox appeared within the bounded wait.");
  },
  recoverSandbox: async (actor) => {
    await warmPersonalCloudSandbox(actor.api, { timeoutMs: FAILURE_RECOVERY_TIMEOUT_MS });
  },
  waitForMaterializationReady: (actor) => waitForPersonalMaterializationReady(actor.api),
  relayManifestReadable: (world) => callbackRelay(world).manifest("stripe").then(() => true).catch(() => false),
};

interface RuntimeProviderDiscovery {
  providerSandboxId: string | null;
  matches?: Array<{ providerSandboxId: string }>;
}

type RuntimeProviderFinder = (cloudSandboxId: string) => Promise<RuntimeProviderDiscovery>;

export async function armRuntimeReadinessFailureWatcher(
  world: ManagedCloudWorld,
  params: { cloudSandboxId: string; operationId: string },
  deps: {
    find?: RuntimeProviderFinder;
    inject?: (world: ManagedCloudWorld, providerSandboxId: string) => Promise<FailureInjectionHandle>;
    processPresent?: (providerSandboxId: string) => Promise<boolean>;
    observeProduct?: typeof observeProviderBindingOnBox;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    postKillQuietChecks?: number;
  } = {},
): Promise<{
  operationId: string;
  waitForInjection(): Promise<{
    providerSandboxId: string;
    handle: FailureInjectionHandle;
    observation: RuntimeReadinessFailureObservation;
  }>;
  disarm(): Promise<void>;
}> {
  const expectedOperation = `runtime-readiness:${world.run.run_id}:${world.run.shard_id}:${params.cloudSandboxId}`;
  if (params.operationId !== expectedOperation) {
    throw new Error("failure-injection: runtime-readiness watcher operation is outside the exact run boundary.");
  }
  const find = deps.find ?? findProviderSandbox;
  const inject = deps.inject ?? ((targetWorld, providerId) =>
    injectFailureAt(targetWorld, "runtime_readiness", { providerSandboxId: providerId }));
  const processPresent = deps.processPresent ?? ((providerId) =>
    providerProcessWithExactExecutablePresent(providerId, "anyharness"));
  const observeProduct = deps.observeProduct ?? observeProviderBindingOnBox;
  const wait = deps.sleep ?? sleep;
  const baseline = await find(params.cloudSandboxId);
  const baselineMatches = baseline.matches ?? (baseline.providerSandboxId
    ? [{ providerSandboxId: baseline.providerSandboxId }]
    : []);
  if (baselineMatches.length !== 0) {
    throw new Error("failure-injection: runtime-readiness watcher found a pre-existing provider sandbox before arming.");
  }
  let disarmed = false;
  const deadline = Date.now() + (deps.timeoutMs ?? FAILURE_RECOVERY_TIMEOUT_MS);
  let injectedHandle: FailureInjectionHandle | undefined;
  // Start the bounded watcher NOW, before returning the armed handle. The
  // product action happens only after this function resolves; polling an empty
  // provider set until then is expected.
  const fired = (async () => {
    while (!disarmed && Date.now() < deadline) {
      const observed = await find(params.cloudSandboxId);
      const matches = observed.matches ?? (observed.providerSandboxId
        ? [{ providerSandboxId: observed.providerSandboxId }]
        : []);
      if (matches.length > 1) {
        throw new Error("failure-injection: runtime-readiness watcher observed ambiguous provider sandboxes.");
      }
      const providerSandboxId = matches[0]?.providerSandboxId;
      if (providerSandboxId) {
        const before = await observeProduct(world, params.cloudSandboxId);
        if (!before || before.providerSandboxId === null) {
          await wait(250);
          continue;
        }
        if (before.providerSandboxId !== providerSandboxId) {
          throw new Error(
            "failure-injection: provider metadata did not match the product row's exact provider binding.",
          );
        }
        if (before.status !== "creating" || before.readyAt !== null) {
          throw new Error(
            `failure-injection: expected exact status=creating before runtime injection; observed ${before.status}.`,
          );
        }
        if (!(await processPresent(providerSandboxId))) {
          await wait(250);
          continue;
        }
        const handle = await inject(world, providerSandboxId);
        injectedHandle = handle;
        if (handle.boundary !== "runtime_readiness" || !handle.injected) {
          throw new Error("failure-injection: runtime-readiness injection did not prove AnyHarness present→absent.");
        }
        const quietChecks = deps.postKillQuietChecks ?? 3;
        if (!Number.isInteger(quietChecks) || quietChecks < 1 || quietChecks > 10) {
          throw new Error("failure-injection: invalid post-kill worker quiet-check count.");
        }
        let after = before;
        for (let check = 0; check < quietChecks; check += 1) {
          await wait(250);
          const observedAfter = await observeProduct(world, params.cloudSandboxId);
          if (!isInjectedRuntimeReadinessFailure(observedAfter, params.cloudSandboxId, providerSandboxId)) {
            throw new Error(
              "failure-injection: product reached ready or changed provider after the AnyHarness kill.",
            );
          }
          after = observedAfter;
        }
        return { providerSandboxId, handle, observation: after };
      }
      await wait(250);
    }
    throw new Error("failure-injection: runtime-readiness watcher did not observe the exact first attempt.");
  })();
  void fired.catch(() => undefined);
  return {
    operationId: params.operationId,
    waitForInjection: () => fired,
    async disarm() {
      disarmed = true;
      await fired.catch(() => null);
      await injectedHandle?.disarm();
    },
  };
}

/**
 * Every required deletion boolean true (mirrors CLOUD-PROVISION-1's
 * `allCleanupBooleansTrue`), PLUS the PR-6/smoke optional categories when present
 * (billingFixtureCleared / relayStopped / stripeFixturesDeleted). An OPTIONAL
 * that is `undefined` (the run registered no entry of that kind) is treated as
 * clean; only an explicit `false` fails.
 */
export function allCleanupBooleansTrue(cleanup: ManagedCloudCleanupEvidence): boolean {
  const required =
    cleanup.sandboxesDeleted &&
    cleanup.templateDeleted !== (cleanup.templateCustodyTransferred === true) &&
    cleanup.dnsRecordDeleted &&
    cleanup.ec2Terminated &&
    cleanup.securityGroupDeleted &&
    cleanup.keyPairDeleted &&
    cleanup.virtualKeyDeleted &&
    cleanup.litellmSubjectsDeleted &&
    cleanup.localPathsRemoved;
  const optionals =
    cleanup.billingFixtureCleared !== false &&
    cleanup.relayStopped !== false &&
    cleanup.stripeFixturesDeleted !== false;
  return required && optionals;
}

/** Compact boolean summary for a cleanup-failure message. */
function cleanupBooleanSummary(c: ManagedCloudCleanupEvidence): string {
  return (
    `sandboxes=${c.sandboxesDeleted} template=${c.templateDeleted} transferred=${c.templateCustodyTransferred} ` +
    `dns=${c.dnsRecordDeleted} ` +
    `ec2=${c.ec2Terminated} sg=${c.securityGroupDeleted} key=${c.keyPairDeleted} vkey=${c.virtualKeyDeleted} ` +
    `subjects=${c.litellmSubjectsDeleted} paths=${c.localPathsRemoved} billing=${c.billingFixtureCleared} ` +
    `relay=${c.relayStopped} stripe=${c.stripeFixturesDeleted}`
  );
}

export const REQUIRED_CELL_A_D_FIXTURE_KINDS = [
  "billing_fixture_adjustment",
  "callback_relay_process",
  "callback_relay_spool",
  "e2b_sandbox",
  "stripe_customer",
  "stripe_product_price",
  "stripe_test_clock",
] as const;

const REQUIRED_CELL_A_D_REPLAY_DOMAINS = ["box", "e2b", "stripe"] as const;

/** Cell E must prove every representative A-D fixture, not merely one row. */
export function assertRepresentativeFixtureReplay(report: ManagedCloudFixtureReplayReportV1): void {
  if (
    report.status !== "reconciled" ||
    report.reconciled_fixture_entries !== report.selected_fixture_entries
  ) {
    throw new Error("cleanup-replay: the fresh executor did not reconcile every selected fixture entry.");
  }
  const missingKinds = REQUIRED_CELL_A_D_FIXTURE_KINDS.filter(
    (kind) => !report.reconciled_fixture_kinds.includes(kind),
  );
  const missingDomains = REQUIRED_CELL_A_D_REPLAY_DOMAINS.filter(
    (domain) => !report.reconciled_domains.includes(domain),
  );
  if (missingKinds.length > 0 || missingDomains.length > 0) {
    throw new Error(
      "cleanup-replay: the fresh executor did not prove the exact representative Cell A-D fixture set " +
        `(missing kinds=${missingKinds.join(",") || "none"}; domains=${missingDomains.join(",") || "none"}).`,
    );
  }
}

/** Cell E — cleanup replay + provider sweeps (spec Cell E; ALWAYS last). */
async function runCleanupReplayCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  closeWorld: () => Promise<ManagedCloudCleanupEvidence | null>,
  http: StripeHttp,
  replayFixturesFresh: FixtureSmokeRuntimeDeps["replayFixturesFresh"],
): Promise<FixtureSmokeCellResult> {
  // One extra tiny fresh resource with intent→acquired to replay. Use the
  // smoke-owned product/price kind: its intent carries a run tag that a fresh
  // executor can recover directly. A bare customer would be incorrect here
  // because the shared stripe_customer intent contract is clock-scoped.
  let extraProductId = "";
  let extraPriceId = "";
  if (world.registerCleanupIntent) {
    const smoke = await import("../fixtures/stripe-smoke-resources.js");
    const handle = await world.registerCleanupIntent(
      "stripe_product_price",
      smoke.encodeProductPriceIntentRef(state.runTag),
      async () => {
        if (extraProductId && extraPriceId) {
          await smoke.deactivateProductPriceById(
            state.secretKey,
            extraProductId,
            extraPriceId,
            http,
          );
        } else {
          await smoke.deactivateRunProductPricesByTag(
            { secretKey: state.secretKey, runTag: state.runTag },
            http,
          );
        }
      },
    );
    const created = await smoke.createRunProductPrice(
      { secretKey: state.secretKey, runTag: state.runTag, unitAmount: 100 },
      http,
    );
    extraProductId = created.productId;
    extraPriceId = created.priceId;
    await handle.markAcquired(smoke.encodeProductPriceProviderId(created.productId, created.priceId));
  }

  // Fresh OS process: reload the ledger with no create-time closures or
  // in-memory provider controllers. The child independently discovers the
  // run-owned ingress from exact AWS tags, rebuilds BoxExec, and replays only
  // fixture entries from persisted identity. A same-process helper call would
  // not establish the frozen restart/recovery contract.
  const replay = await replayFixturesFresh(
    world.paths.runDir,
    world.run.run_id,
    world.run.shard_id,
  );
  assertRepresentativeFixtureReplay(replay);
  const reloadedAfter = await loadCleanupLedger(world.paths.runDir);
  const unreconciledFixtureAfter = reloadedAfter
    .entries()
    .filter((entry) => FIXTURE_REPLAY_KINDS.has(entry.kind) && entry.phase !== "reconciled");
  if (unreconciledFixtureAfter.length > 0) {
    throw new Error(
      `cleanup-replay: ${unreconciledFixtureAfter.length} fixture ledger entr(y/ies) remained unreconciled after ` +
        "replay from a fresh executor (recovery from persisted identity failed).",
    );
  }

  // Close the world (releasers are idempotent; Stripe deletes tolerate
  // resource_missing, so a double-release after the replay above is safe). Capture
  // the cleanup evidence so the sweep + gate below use the REAL close result
  // rather than hardcoded zeros.
  const closeEvidence = await closeWorld();
  if (!closeEvidence) {
    throw new Error(
      "cleanup-replay: the world was already closed before this cell ran — cannot gate on its cleanup evidence.",
    );
  }
  // Gate on the full cleanup block (mirrors CLOUD-PROVISION-1's allCleanupBooleansTrue),
  // INCLUDING the PR-6/smoke optionals when present: any failed releaser or any
  // false deletion boolean fails the cell.
  if (closeEvidence.failed > 0 || !allCleanupBooleansTrue(closeEvidence)) {
    throw new Error(
      `cleanup-replay: world close did not fully reconcile (failed=${closeEvidence.failed}, ` +
        `${cleanupBooleanSummary(closeEvidence)}).`,
    );
  }

  // Provider sweeps: prove ZERO owned resources remain.
  const sweeps: ManagedCloudFixtureSmokeEvidenceV1["provider_sweeps"] = [];

  const aws = await sweepAwsForRun({
    region: state.aws.region,
    hostedZoneId: state.aws.hostedZoneId,
    recordName: state.prep.subdomain,
    runId: world.run.run_id,
    shardId: world.run.shard_id,
    keyNamePrefix: `mcq-${world.run.run_id}-${world.run.shard_id}`,
  }).catch((error) => ({
    remaining: 1,
    detail: { instances: 1, securityGroups: 0, keyPairs: 0, dnsRecords: 0 },
    errors: [describe(error)],
  }));
  sweeps.push({ provider: "aws", remaining_owned_resources: aws.remaining });

  // Stripe sweep: paginated counts of run-owned resources.
  const smoke = await import("../fixtures/stripe-smoke-resources.js");
  const clockFixture = await import("../fixtures/stripe-test-clock.js");
  const clockName = clockFixture.clockNameForRun(state.runTag);
  const remainingClocks = await smoke.countRunTestClocks({ secretKey: state.secretKey, name: clockName }, http);
  const remainingCustomers = await smoke.countRunCustomers({ secretKey: state.secretKey, runTag: state.runTag }, http);
  const remainingWebhooks = await smoke.countRunWebhookEndpoints(
    { secretKey: state.secretKey, url: webhookEndpointUrl(state.prep.subdomain) },
    http,
  );
  const remainingProductsAndPrices = await smoke.countActiveRunProductsAndPrices(
    { secretKey: state.secretKey, runTag: state.runTag },
    http,
  );
  sweeps.push({
    provider: "stripe",
    remaining_owned_resources:
      remainingClocks + remainingCustomers + remainingWebhooks + remainingProductsAndPrices,
  });

  // E2B: independently drain the provider's running/paused inventory and count
  // sandboxes whose observed immutable template id equals this world's exact
  // candidate receipt. The expected count is zero even though this smoke does
  // not intentionally create a sandbox: an orphan from a partial operation must
  // not be hidden by that assumption.
  const e2b = await sweepE2bForTemplate(world.artifacts.template.templateId);
  sweeps.push({ provider: "e2b", remaining_owned_resources: e2b.remaining });

  // Process: the relay can execute only on the run-owned ingress host. Reuse the
  // independent post-close AWS observation (not a cleanup boolean) to prove that
  // no host remains capable of running it.
  const processSweep = sweepProcessHostFromAws(aws);
  sweeps.push({
    provider: "process",
    remaining_owned_resources: processSweep.remaining,
  });

  // Filesystem: lstat the actual scoped run directory after close. Only ENOENT
  // proves absence; permission and I/O errors stay ambiguous/non-green.
  const filesystem = await sweepFilesystemPaths([
    state.prep.scopedRunDir,
    state.prep.webhookIntentFilePath,
  ]);
  sweeps.push({
    provider: "filesystem",
    remaining_owned_resources: filesystem.remaining,
  });

  const totalRemaining = sweeps.reduce((sum, s) => sum + s.remaining_owned_resources, 0);
  if (totalRemaining > 0) {
    throw new Error(
      `cleanup-replay: provider sweeps found ${totalRemaining} owned resource(s) remaining after cleanup ` +
        `(${sweeps.map((s) => `${s.provider}=${s.remaining_owned_resources}`).join(", ")}).`,
    );
  }

  return {
    externalIds: extraProductId && extraPriceId ? [extraProductId, extraPriceId] : [],
    observedTransition: "extra_resource_created→replayed_from_fresh_executor→world_closed→swept_zero",
    cleanupEntries: replay.reconciled_fixture_kinds,
    providerSweeps: sweeps,
  };
}

/** Polls `read` until `done(value)` or the deadline; returns the last value. */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(intervalMs);
    value = await read();
  }
  return value;
}
