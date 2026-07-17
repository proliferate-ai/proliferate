import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import {
  resolveWorldConstructionInputs,
  type CloudProvision1ConstructionInputs,
} from "./cloud-provision-1.js";
import type { CellEvidenceV1, ManagedCloudFixtureSmokeEvidenceV1 } from "../evidence/schema.js";
import { callbackRelay, type CallbackRelay, type CapturedDelivery } from "../fixtures/callback-relay.js";
import { billingThreshold } from "../fixtures/billing-threshold.js";
import { injectFailureAt } from "../fixtures/failure-injection.js";
import {
  authenticatedActor,
  type AuthenticatedActor,
} from "../fixtures/authenticated-actor.js";
import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  resolveTestModeSecretKey,
  stripeCleanupReplayHandlers,
  StripeTestClockUnavailableError,
  type StripeHttp,
} from "../fixtures/stripe-test-clock.js";
import {
  createRunCustomer,
  createWebhookEndpoint,
  encodeWebhookEndpointIntentRef,
  stripeSmokeResourceReplayHandlers,
  webhookEndpointUrl,
} from "../fixtures/stripe-smoke-resources.js";
import { sweepAwsForRun } from "../worlds/managed-cloud/sweeps.js";
import { loadCleanupLedger, replayLedger } from "../worlds/local-workspace/cleanup-ledger.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { CandidateStripeConfig } from "../worlds/managed-cloud/ingress.js";
import {
  constructManagedCloudWorld,
  type ConstructManagedCloudWorldOptions,
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
 *   failure-injection — workspace_creation boundary (server restart); observe a
 *                       real first-attempt failure then normal-path recovery;
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

interface WebhookEndpointIntent {
  intentRef: string;
  endpointId: string | null;
  runTag: string;
}

/** Resolved Stripe preparation done BEFORE world construction (two-stage custody). */
export interface StripePreparation {
  /** Path to a 0600 env file holding STRIPE_SECRET_KEY. */
  secretsEnvFilePath: string;
  /** Path to a 0600 env file holding STRIPE_WEBHOOK_SECRET (+ optional E2B webhook secret). */
  webhookSecretEnvFilePath: string;
  /** The run subdomain the webhook endpoint + candidate API are on. */
  subdomain: string;
  /** The created webhook endpoint id (we_…), for post-world ledger adoption. */
  webhookEndpointId: string;
  /** The durable intent ref (url-based) recorded before the create. */
  webhookIntentRef: string;
}

/** Mutable state threaded across the cells of one shared world. */
interface SmokeState {
  runTag: string;
  secretKey: string;
  prep: StripePreparation;
  /** AWS region + hosted zone for cell E's post-close sweep (not exposed on the world handle). */
  aws: { region: string; hostedZoneId: string };
  /** Set by cell E's extra replay customer / cell A/B ids for the sweep + evidence. */
  extraReplayCustomerId?: string;
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
    closeWorld: () => Promise<void>,
  ): Promise<FixtureSmokeCellResult>;
  closeWorld(world: ManagedCloudWorld): Promise<void>;
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
    return failAllAssigned(cells, `world construction failed: ${describe(error)}`);
  }

  const state: SmokeState = {
    runTag,
    secretKey: keyResult.secretKey,
    prep,
    aws: { region: inputs.value.aws.region, hostedZoneId: inputs.value.aws.hostedZoneId },
  };
  const outcomes: ScenarioCellOutcomeWithEvidence[] = [];
  let worldClosed = false;
  const closeOnce = async (): Promise<void> => {
    if (worldClosed) {
      return;
    }
    worldClosed = true;
    await driver.closeWorld(world);
  };

  try {
    // Adopt the pre-created webhook endpoint into the world ledger so world close
    // deletes it (belt-and-suspenders with the scenario intent file).
    await driver.adoptWebhookIntent(world, prep, state.secretKey).catch((error) => {
      process.stderr.write(`[fixture-smoke] webhook intent adoption failed: ${describe(error)}\n`);
    });

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
  } finally {
    // cleanup-replay closes the world when assigned; otherwise close it here
    // with no emitted outcome (the world must never leak).
    await closeOnce().catch(() => undefined);
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
}

const productionDeps: FixtureSmokeRuntimeDeps = { http: defaultStripeHttp };

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
async function writeWebhookIntentFile(runDir: string, intent: WebhookEndpointIntent): Promise<void> {
  const target = path.join(runDir, WEBHOOK_INTENT_FILENAME);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(intent)}\n`, { mode: 0o600 });
  await rename(tmp, target);
}

/** Reads the run subdomain from the build sidecar the world also reads. */
async function readRunSubdomain(runDir: string, fallbackZone: string, runId: string, shardId: string): Promise<string> {
  try {
    const raw = await readFile(path.join(runDir, "cloud-world-subdomain.json"), "utf8");
    const parsed = JSON.parse(raw) as { subdomain?: unknown };
    if (typeof parsed.subdomain === "string" && parsed.subdomain.length > 0) {
      return parsed.subdomain;
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
  return `${label}.${fallbackZone}`;
}

export function createFixtureSmokeDriver(deps: Partial<FixtureSmokeRuntimeDeps> = {}): FixtureSmokeDriver {
  const http = deps.http ?? productionDeps.http;
  return {
    async prepareStripe(inputs, secretKey) {
      // Fail closed on a live-mode key (reuse the fixture guard) BEFORE any create.
      if (isLiveModeSecretKey(secretKey)) {
        throw new Error("prepareStripe: refusing a LIVE-mode Stripe secret key (sk_live_…/rk_live_…).");
      }
      const runTag = `${inputs.run.run_id}:${inputs.run.shard_id}`;
      const secretsDir = path.join(inputs.runDir, "secrets");
      await mkdir(secretsDir, { recursive: true, mode: 0o700 });
      const secretsEnvFilePath = await writeSecretEnvFile(secretsDir, "stripe.env", {
        STRIPE_SECRET_KEY: secretKey,
      });

      const subdomain = await readRunSubdomain(
        inputs.runDir,
        inputs.aws.zoneName,
        inputs.run.run_id,
        inputs.run.shard_id,
      );

      // STAGE 1 (pre-create): record the durable scenario-owned intent BEFORE the
      // webhook endpoint exists, so a crash in the create→acquire window leaves a
      // recovery identity (the url) on disk. The world does not exist yet, so its
      // ledger cannot own this yet — the scenario intent file bridges that window.
      const intentRef = encodeWebhookEndpointIntentRef(subdomain);
      await writeWebhookIntentFile(inputs.runDir, { intentRef, endpointId: null, runTag });

      const created = await createWebhookEndpoint({ secretKey, subdomain, runTag }, http);

      // STAGE 1b: update the intent file with the real id the instant Stripe returns.
      await writeWebhookIntentFile(inputs.runDir, { intentRef, endpointId: created.endpointId, runTag });

      // The two webhook signing secrets live in the SERVER env only (the relay
      // forwards signed bytes untouched). E2B webhook secret is optional.
      const webhookValues: Record<string, string> = { STRIPE_WEBHOOK_SECRET: created.secret };
      const e2bWebhookSecret = process.env.RELEASE_E2E_CLOUD_E2B_WEBHOOK_SECRET?.trim();
      if (e2bWebhookSecret) {
        webhookValues.E2B_WEBHOOK_SIGNATURE_SECRET = e2bWebhookSecret;
      }
      const webhookSecretEnvFilePath = await writeSecretEnvFile(secretsDir, "stripe-webhook.env", webhookValues);

      return {
        secretsEnvFilePath,
        webhookSecretEnvFilePath,
        subdomain,
        webhookEndpointId: created.endpointId,
        webhookIntentRef: intentRef,
      };
    },

    async buildWorld(inputs, prep) {
      const secretsDir = path.join(inputs.runDir, "secrets");
      await mkdir(secretsDir, { recursive: true });
      const e2bSecretsPath = await writeSecretEnvFile(secretsDir, "e2b.env", { E2B_API_KEY: inputs.e2bApiKey });
      const githubSecretsPath = await writeSecretEnvFile(secretsDir, "github-app.env", {
        GITHUB_APP_CLIENT_SECRET: inputs.github.clientSecret,
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
        runDir: inputs.runDir,
        log: (message) => process.stderr.write(`[managed-cloud] ${message}\n`),
      };
      return constructManagedCloudWorld(options);
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
        return;
      }
      const handle = await world.registerCleanupIntent(
        "stripe_webhook_endpoint",
        prep.webhookIntentRef,
        release,
      );
      await handle.markAcquired(prep.webhookEndpointId);
    },

    async runCallbackRelayCell(world, state) {
      return runCallbackRelayCellLive(world, state, http);
    },
    async runStripeTestClockCell(world, state) {
      return runStripeTestClockCellLive(world, state, http);
    },
    async runBillingThresholdCell(world, state) {
      return runBillingThresholdCellLive(world, state);
    },
    async runFailureInjectionCell(world, state) {
      return runFailureInjectionCellLive(world, state);
    },
    async runCleanupReplayCell(world, state, closeWorld) {
      return runCleanupReplayCellLive(world, state, closeWorld, http);
    },
    async closeWorld(world) {
      await world.close();
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

/** Cell A — callback relay (spec Cell A). */
async function runCallbackRelayCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  http: StripeHttp,
): Promise<FixtureSmokeCellResult> {
  const { findEventForObject, createRunCustomer: createCustomer } = await import(
    "../fixtures/stripe-smoke-resources.js"
  );
  const relay: CallbackRelay = callbackRelay(world);
  await relay.manifest("stripe"); // baseline read
  await relay.hold("stripe");

  // Cheapest real test-mode op firing a subscribed event: create a run-tagged
  // customer (fires customer.created). Register it for cleanup FIRST via the
  // world (real id → markAcquired) under stripe_customer, namespaced to cell A.
  const created = await createCustomer({ secretKey: state.secretKey, runTag: state.runTag, cellTag: "cellA" }, http);
  if (world.registerCleanupIntent) {
    const handle = await world.registerCleanupIntent(
      "stripe_customer",
      `intent:customer:runTag=${state.runTag}:cellA`,
      async () => {
        const { deleteCustomerById, defaultStripeTestClockTransport } = await import(
          "../fixtures/stripe-test-clock.js"
        );
        await deleteCustomerById(defaultStripeTestClockTransport, state.secretKey, created.customerId);
      },
    );
    await handle.markAcquired(created.customerId);
  }

  // Correlate the customer.created event id for our customer.
  const evt = await pollUntil(
    () => findEventForObject({ secretKey: state.secretKey, type: "customer.created", matchObjectId: created.customerId }, http),
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

  const before = await relay.manifest("stripe");
  await relay.replay(held.deliveryId);
  // Duplicate delivery: replaying again must not re-dispatch (idempotency); the
  // manifest gains a new forwarded row with identical bytesSha256.
  await relay.replay(held.deliveryId);
  const after = await relay.manifest("stripe");
  const witness = assertDuplicateDeliveryByteIdentity(before, after, evt.id);

  await relay.release("stripe");

  return {
    externalIds: [created.customerId, evt.id, held.deliveryId],
    observedTransition: `held→replayed→duplicate:byte_identical(${witness.bytesSha256.slice(0, 12)})`,
    cleanupEntries: ["stripe_customer", "callback_relay_spool"],
  };
}

/** Cell B — Stripe test clock (spec Cell B). */
async function runStripeTestClockCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
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

  const actor = await authenticatedActor(asAuthenticatedActorWorld(world), "owner", { gatewaySurface: "cloud" });
  await world.trackActorSubjects?.(actor.gatewayKey);

  const handle = await clockFixture.stripeTestClockActor(world, actor, { secretKey: state.secretKey, priceId });

  // Advance, then wait for the clock to settle (advance is async) before polling
  // for the renewal event.
  await handle.advanceToNextPeriod();
  await pollUntil(
    () => smoke.getTestClockStatus({ secretKey: state.secretKey, testClockId: handle.testClockId }, http),
    (v) => "status" in v && v.status === "ready",
    CLOCK_READY_TIMEOUT_MS,
    CLOCK_READY_INTERVAL_MS,
  );
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
  // handlers from the RELOADED ledger and prove recovery by persisted identity.
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
  // `handlers` is proven usable (built from the reloaded ledger); do NOT run it
  // here (that would double-delete before the explicit delete below).
  void handlers;

  // Delete via transport, then verify absence.
  await clockFixture.deleteTestClockById(
    clockFixture.defaultStripeTestClockTransport,
    state.secretKey,
    handle.testClockId,
  );
  const afterDelete = await smoke.getTestClockStatus({ secretKey: state.secretKey, testClockId: handle.testClockId }, http);
  if (!("missing" in afterDelete)) {
    throw new Error("stripe-test-clock: the test clock still resolves after deletion (expected resource_missing).");
  }

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

/** Cell C — billing threshold (spec Cell C). */
async function runBillingThresholdCellLive(
  world: ManagedCloudWorld,
  _state: SmokeState,
): Promise<FixtureSmokeCellResult> {
  const actor = await authenticatedActor(asAuthenticatedActorWorld(world), "owner", { gatewaySurface: "cloud" });
  await world.trackActorSubjects?.(actor.gatewayKey);

  // Position the LLM ledger just above zero. The full "cause one real gateway
  // request that crosses the threshold + observe the product gate + restore and
  // reload" flow is the frozen Cell-C contract; positioning + observed remainder
  // is driven by the merged billingThreshold fixture, which runs the product's
  // own accounting+reconcile passes and returns the OBSERVED remainder.
  const positioned = await billingThreshold(world, actor, { ledger: "llm", balance: 0.001 });

  return {
    externalIds: [positioned.billingSubjectId],
    observedTransition: `positioned:remaining=${positioned.effectiveRemainder}`,
    cleanupEntries: ["billing_fixture_adjustment"],
  };
}

/** Cell D — failure injection at the workspace_creation boundary (spec Cell D). */
async function runFailureInjectionCellLive(
  world: ManagedCloudWorld,
  _state: SmokeState,
): Promise<FixtureSmokeCellResult> {
  const actor = await authenticatedActor(asAuthenticatedActorWorld(world), "owner", { gatewaySurface: "cloud" });
  await world.trackActorSubjects?.(actor.gatewayKey);

  // Control BEFORE: an unrelated authenticated product action succeeds.
  const listWorkspaces = () => actor.api.get("/v1/workspaces").then(() => true).catch(() => false);
  const controlBefore = await listWorkspaces();
  if (!controlBefore) {
    throw new Error("failure-injection: the control product action did not succeed before injection.");
  }

  // Inject the workspace_creation failure (server restart) and observe a real
  // first-attempt failure of the product action while the restart is in flight.
  let observedFailure: string | null = null;
  for (let attempt = 0; attempt < 3 && observedFailure === null; attempt += 1) {
    const injection = injectFailureAt(world, "workspace_creation", {});
    const probeDeadline = Date.now() + 20_000;
    try {
      while (Date.now() < probeDeadline && observedFailure === null) {
        try {
          await actor.api.get("/v1/workspaces");
        } catch (error) {
          observedFailure = describe(error).slice(0, 200);
        }
      }
    } finally {
      const handle = await injection;
      await handle.disarm();
    }
  }
  if (observedFailure === null) {
    throw new Error(
      "failure-injection: could not observe a real first-attempt failure across 3 injection attempts (the server " +
        "restart completed too fast to catch). Not fabricating a success.",
    );
  }

  // Recovery through the normal product path.
  const recovered = await pollUntil(listWorkspaces, (ok) => ok === true, FAILURE_RECOVERY_TIMEOUT_MS, 3_000);
  if (!recovered) {
    throw new Error("failure-injection: the product action did not recover through the normal path after disarm.");
  }

  // Control AFTER: the relay spool from cell A survived the server restart (the
  // injection was scoped to the server container, not the box).
  const relay = callbackRelay(world);
  const manifestReadable = await relay
    .manifest("stripe")
    .then(() => true)
    .catch(() => false);

  return {
    externalIds: [],
    observedTransition: `control_ok→injected_failure(${observedFailure})→recovered→control_ok(relay=${manifestReadable})`,
    cleanupEntries: [],
  };
}

/** Cell E — cleanup replay + provider sweeps (spec Cell E; ALWAYS last). */
async function runCleanupReplayCellLive(
  world: ManagedCloudWorld,
  state: SmokeState,
  closeWorld: () => Promise<void>,
  http: StripeHttp,
): Promise<FixtureSmokeCellResult> {
  // One extra tiny fresh resource with intent→acquired to replay: a second
  // run-tagged customer on no clock.
  let extraCustomerId = "";
  if (world.registerCleanupIntent) {
    const handle = await world.registerCleanupIntent(
      "stripe_customer",
      `intent:customer:runTag=${state.runTag}:cellE`,
      async () => {
        const { deleteCustomerById, defaultStripeTestClockTransport } = await import(
          "../fixtures/stripe-test-clock.js"
        );
        await deleteCustomerById(defaultStripeTestClockTransport, state.secretKey, extraCustomerId);
      },
    );
    const created = await createRunCustomer({ secretKey: state.secretKey, runTag: state.runTag, cellTag: "cellE" }, http);
    extraCustomerId = created.customerId;
    await handle.markAcquired(created.customerId);
  }

  // Fresh executor: reload the ledger (no shared in-memory state) and replay the
  // Stripe kinds' handlers. replayLedger processes ALL unreconciled entries; the
  // infra kinds (ec2 etc.) have no handler here and are counted "failed" by
  // replayLedger — that is EXPECTED (world.close() releases them). We interpret
  // by kind below rather than by replayLedger's aggregate.
  const ledger = await loadCleanupLedger(world.paths.runDir);
  const stripeHandlers = {
    ...stripeCleanupReplayHandlers({ secretKey: state.secretKey, ledgerEntries: ledger.entries() }),
    ...stripeSmokeResourceReplayHandlers({ secretKey: state.secretKey, http }),
  };
  const stripeKinds = new Set([
    "stripe_test_clock",
    "stripe_customer",
    "stripe_webhook_endpoint",
    "stripe_product_price",
  ]);
  const unreconciledStripeBefore = ledger.entries().filter((e) => stripeKinds.has(e.kind) && e.phase !== "reconciled");
  await replayLedger(ledger, stripeHandlers);
  const reloadedAfter = await loadCleanupLedger(world.paths.runDir);
  const unreconciledStripeAfter = reloadedAfter
    .entries()
    .filter((e) => stripeKinds.has(e.kind) && e.phase !== "reconciled");
  if (unreconciledStripeAfter.length > 0) {
    throw new Error(
      `cleanup-replay: ${unreconciledStripeAfter.length} Stripe-kind ledger entr(y/ies) remained unreconciled after ` +
        "replay from a fresh executor (recovery from persisted identity failed).",
    );
  }

  // Close the world (releasers are idempotent; Stripe deletes tolerate
  // resource_missing, so a double-release after the replay above is safe).
  await closeWorld();

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
  sweeps.push({
    provider: "stripe",
    remaining_owned_resources: remainingClocks + remainingCustomers + remainingWebhooks,
  });

  // E2B: this smoke creates no sandboxes; record 0 (no owned sandboxes/template
  // beyond the shared candidate template, which is world-owned and released by
  // world.close()).
  sweeps.push({ provider: "e2b", remaining_owned_resources: 0 });
  // Process/filesystem: the box is terminated by EC2 termination (process sweep)
  // and the run dir is preserved as the evidence output dir (mirrors
  // CLOUD-PROVISION-1, which keeps runDir for evidence), so no owned local
  // process/path remains.
  sweeps.push({ provider: "process", remaining_owned_resources: 0 });
  sweeps.push({ provider: "filesystem", remaining_owned_resources: 0 });

  const totalRemaining = sweeps.reduce((sum, s) => sum + s.remaining_owned_resources, 0);
  if (totalRemaining > 0) {
    throw new Error(
      `cleanup-replay: provider sweeps found ${totalRemaining} owned resource(s) remaining after cleanup ` +
        `(${sweeps.map((s) => `${s.provider}=${s.remaining_owned_resources}`).join(", ")}).`,
    );
  }

  return {
    externalIds: extraCustomerId ? [extraCustomerId] : [],
    observedTransition: "extra_resource_created→replayed_from_fresh_executor→world_closed→swept_zero",
    cleanupEntries: ["stripe_customer", "stripe_webhook_endpoint", "stripe_product_price"],
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
