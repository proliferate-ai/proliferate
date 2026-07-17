import { mkdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { Browser } from "playwright";

import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import { resolveCloudCandidateSet } from "../../artifacts/cloud-candidate-set.js";
import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import { materializeLocalArtifact } from "../../artifacts/materialize-local.js";
import { ApiClient } from "../../fixtures/http.js";
import {
  killProviderSandbox,
  listProviderSandboxesByTemplate,
  listProviderTemplates,
} from "../../fixtures/e2b-verify.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import {
  QualificationLiteLlmController,
  type ActorKeyIdentity,
  type ActorSubjectsDeletion,
  type FetchLike,
  type QualificationLiteLlmConfig,
} from "../../services/qualification-litellm.js";
import {
  deleteActorEnrollmentSubjects,
  resolveActorEnrollmentProviderBinding,
} from "./base-world-litellm-replay.js";
import { openCleanupLedger, type CleanupLedgerMirror } from "../local-workspace/cleanup-ledger.js";
import type { Exec } from "../local-workspace/docker.js";
import type { ReadinessFetch, SpawnLike } from "../local-workspace/processes.js";
import {
  extractRenderer,
  launchChromium,
  serveRenderer,
  type ChromiumLauncher,
} from "../local-workspace/renderer.js";
import {
  ManagedCloudCleanupStack,
  type ManagedCloudCleanupEvidence,
  type ManagedCloudCleanupKind,
} from "./cleanup-kinds.js";
import {
  captureHostProcessCustody,
  capturePlaywrightBrowserCustody,
  RENDERER_PROCESS_INTENT_PREFIX,
} from "./host-process-custody.js";
import {
  AwsCliEc2Provisioner,
  provisionRunIngress,
  type Ec2ProvisionConfig,
  type Ec2Provisioner,
  type Ec2ResourceTags,
} from "./ec2.js";
import { createBoxExec, type BoxExec } from "./box-exec.js";
import {
  actorEnrollmentIntent,
  bindActorEnrollment,
  encodeActorEnrollmentCustody,
  resolveActorEnrollmentOnBox,
  type ActorEnrollmentLookup,
  type RecoveredActorEnrollmentV1,
} from "./actor-enrollment-custody.js";
import {
  deployCandidateApi,
  defaultSshExec,
  type CandidateApiReceipt,
  type CandidateCallbackRelayConfig,
  type CandidateE2bConfig,
  type CandidateGithubAppConfig,
  type CandidateStripeConfig,
  type SshExec,
} from "./ingress.js";
import {
  computeManagedCloudTemplateHash,
  E2bTemplateBuilder,
  readE2bApiKey,
  resolveOrBuildManagedCloudTemplate,
  type E2bBuildConfig,
  type E2bTemplateReceipt,
  type ManagedCloudTemplateBuilder,
  type ManagedCloudTemplateInputs,
  type ResolveOrBuildManagedCloudTemplateOptions,
} from "./template.js";
import {
  assertSharedTemplateCustodyAcquired,
  loadSharedTemplateCustody,
  markSharedTemplateAcquired,
  markSharedTemplateReleased,
  recordSharedTemplateIntent,
  type SharedTemplateCustodyIdentityV1,
} from "./shared-template-custody.js";
import { cleanupSharedTemplateProviderResources } from "./shared-template-provider-cleanup.js";

/** Host filename the first-run setup token is copied down to under the run directory. */
const SETUP_TOKEN_FILENAME = "setup-token";
/** Agent CLI kinds baked into the template + probed live (this world is claude-only). */
const DEFAULT_AGENT_KINDS = ["claude"];
const SHARED_TEMPLATE_CLEANUP_POLICY = {
  sandboxAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
  templateAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
} as const;

/**
 * The reusable managed-cloud-world constructor (spec "World construction").
 * World setup makes the candidate API and immutable template AVAILABLE; it must
 * NOT pre-create the user's sandbox — provisioning is the scenario behavior
 * (spec). Like `ReadyLocalWorld`, it consumes validated artifacts, resolved
 * LiteLLM access, and the run identity and returns a ready typed handle — not a
 * bag of environment variables. Secrets and privileged provider/AWS/E2B methods
 * stay private inside the world; scenario code receives only product clients,
 * the public API origin, the browser, safe identity helpers, provider
 * ground-truth seams (E2B verify), and the cleanup interface it needs.
 *
 * The same TypeScript code runs locally and in GitHub Actions.
 */

/** Handle returned by `registerCleanupIntent`: durably promote intent → real id. */
export interface CleanupIntentHandle {
  /** The ledger entry id (for diagnostics/tests). */
  entryId: string;
  /** Durably replaces the entry's providerId with the real provider id (post-create). */
  markAcquired(realProviderId: string): Promise<void>;
}

export interface ManagedCloudWorld {
  kind: "managed-cloud";
  run: RunIdentityV1;

  /**
   * The qualified artifact set. The six materialized build-map artifacts, plus
   * the two composite receipts the world produces (the immutable E2B template
   * and the deployed candidate API). Every id + digest here is what evidence
   * `artifact_ids` binds.
   */
  artifacts: {
    server: MaterializedArtifact;
    anyharness: MaterializedArtifact;
    worker: MaterializedArtifact;
    supervisor: MaterializedArtifact;
    credentialHelper: MaterializedArtifact;
    desktopRenderer: MaterializedArtifact;
    template: E2bTemplateReceipt;
    candidateApi: CandidateApiReceipt;
  };

  /** The public candidate API over TLS (the `--lane cloud` target). */
  api: {
    /** `https://<run>.qualification.proliferate.com`. */
    baseUrl: string;
    client: ApiClient;
  };

  /** The Desktop renderer targeted at the public candidate API origin. */
  renderer: {
    baseUrl: string;
    browser: Browser;
  };

  /** Reused PR 1 LiteLLM controller (preflight/correlation/subject deletion). */
  gateway: QualificationLiteLlmController;

  /**
   * Direct E2B provider ground-truth seam (reuses src/fixtures/e2b-verify.ts):
   * resolve the provider sandbox by the product cloud-sandbox id, read its
   * running state + provider timing source, and exec/read inside it to verify
   * Worker/Supervisor parentage and versions. Never a product-mutating lever.
   */
  sandbox: {
    e2bTeamId: string;
  };

  /**
   * Server-side exec seam on the candidate box (SSH → `docker exec
   * candidate-server python …`). The Core-funding entitlement seed and the
   * GitHub-authorization refresh-seed run the product's OWN store/service
   * functions against the candidate box's DB through this (there is no public
   * endpoint for either). Absent only when construction is faked without a box.
   */
  box?: BoxExec;

  paths: {
    runDir: string;
    /** Where run-owned key files / secret env files live (mode 0600). */
    secretsDir: string;
  };

  /**
   * Registers a durable, reverse-order cleanup releaser for a resource a fixture
   * or scenario creates on top of the world (e.g. the user's E2B sandbox once
   * provisioning creates it, or a per-actor browser context). Additive seam
   * beyond the spec's field list; runs during `close()`.
   */
  registerCleanup?(
    kind: ManagedCloudCleanupKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void>;

  /**
   * Two-phase (INTENT → ACQUIRED) durable registration for a resource whose real
   * provider id is only known AFTER a create call that must be recoverable if the
   * runner dies mid-create. Unlike `registerCleanup` (which collapses intent +
   * acquired into one shot), this persists the ledger entry with `intentRef` as
   * its durable providerId BEFORE the create is issued, and returns
   * `markAcquired(realProviderId)` to durably replace it the instant the provider
   * returns. `intentRef` must carry a deterministic run-scoped RECOVERY IDENTITY
   * (e.g. a clock name or run tag) so a lost runner can locate + delete the
   * created resource from the reloaded ledger entry ALONE (see
   * `stripeCleanupReplayHandlers`). Additive seam; absent on PR-2 worlds, whose
   * callers fall back to the single-shot `registerCleanup`.
   */
  registerCleanupIntent?(
    kind: ManagedCloudCleanupKind,
    intentRef: string,
    release: () => Promise<void>,
  ): Promise<CleanupIntentHandle>;

  /**
   * Enrols the actor's LiteLLM virtual key + user + team for deletion during
   * `close()`, ordered before local teardown so the deterministic alias stays
   * recoverable (reused PR 1 semantics). The actor identity only exists after
   * enrolment, so it cannot be known at construction.
   */
  trackActorSubjects?(actor: ActorKeyIdentity): Promise<void>;

  /**
   * Enrollment-boundary variant used by managed-cloud actor fixtures. It
   * resolves the exact deterministic key alias and durably registers all three
   * subjects before the actor can reach funding or any scenario action.
   */
  resolveAndTrackActorSubjects?(params: {
    userId: string;
    enrollmentId: string;
  }): Promise<ActorKeyIdentity>;

  /** Persists one composite enrollment cleanup intent before actor creation. */
  beginActorEnrollmentCustody?(params: { email: string }): Promise<{
    resolveAndTrack(params: { userId: string; enrollmentId: string }): Promise<ActorKeyIdentity>;
  }>;

  close(): Promise<ManagedCloudCleanupEvidence>;
}

/**
 * Everything the constructor needs. `map` is the validated, path-bearing
 * `CandidateBuildMapV1` (in-memory only; never serialized). `litellm`/`aws`/
 * `e2b`/`github` carry typed, preflighted access (secret VALUES only via 0600
 * env files, never fields). `runDir` is the run/shard-scoped layout.
 */
export interface ConstructManagedCloudWorldOptions {
  run: RunIdentityV1;
  map: CandidateBuildMapV1;
  litellm: QualificationLiteLlmConfig;
  aws: Ec2ProvisionConfig;
  e2b: E2bBuildConfig & CandidateE2bConfig;
  github: CandidateGithubAppConfig;
  /**
   * PR 6 (append-only): Stripe TEST-mode config for the candidate Server,
   * threaded verbatim into `deployCandidateApi`. Absent (the default) keeps the
   * candidate Server's no-Stripe 503 checkout posture (CLOUD-PROVISION-1
   * regression untouched).
   */
  stripe?: CandidateStripeConfig;
  /**
   * PR 6 (append-only): on-box signed-callback relay config, threaded verbatim
   * into `deployCandidateApi`. Absent (the default) stages no relay and produces
   * the byte-identical single-proxy Caddyfile.
   */
  callbackRelay?: CandidateCallbackRelayConfig;
  /** Run/shard-scoped root; all world state lives under here. */
  runDir: string;
  /**
   * Default worlds build/delete their own template. The two-stage live proof
   * instead transfers one exact immutable template from the base regression to
   * the fixture smoke through a durable parent-run custody journal.
   */
  templateCustody?:
    | { mode: "world_owned" }
    | { mode: "shared_producer"; journalPath: string }
    | { mode: "shared_consumer"; journalPath: string };
  /** Agent CLI kinds baked into the template (defaults to `["claude"]`). */
  agentKinds?: string[];
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Injectable seams; all default to the real world. Unit tests pass fakes so
   * no real AWS/E2B/docker/SSH/browser/network is touched. */
  deps?: ManagedCloudWorldDeps;
}

export interface ManagedCloudWorldDeps {
  litellmFetch?: FetchLike;
  ec2Provisioner?: Ec2Provisioner;
  ssh?: SshExec;
  templateBuilder?: ManagedCloudTemplateBuilder;
  /** Overrides the template resolve/build orchestration (workstream B owns the
   * default); a seam so this world's unit tests stay offline and independent. */
  resolveTemplate?: (options: ResolveOrBuildManagedCloudTemplateOptions) => Promise<E2bTemplateReceipt>;
  probeHealth?: (origin: string) => Promise<{ ok: boolean; version: string }>;
  chromiumLauncher?: ChromiumLauncher;
  spawn?: SpawnLike;
  rendererFetch?: ReadinessFetch;
  extractExec?: Exec;
  /** Fixed local renderer port (default: an OS-allocated ephemeral port). */
  rendererPort?: number;
  ledgerMirror?: CleanupLedgerMirror;
  /** Provider-safe shared-template release; injectable for offline world tests. */
  cleanupSharedTemplate?: (
    receipt: E2bTemplateReceipt,
    config: E2bBuildConfig,
    builder: ManagedCloudTemplateBuilder,
  ) => Promise<void>;
}

async function cleanupSharedTemplate(
  receipt: E2bTemplateReceipt,
  config: E2bBuildConfig,
  builder: ManagedCloudTemplateBuilder,
): Promise<void> {
  const apiKey = readE2bApiKey(config.secretsEnvFilePath);
  const providerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RELEASE_E2E_E2B_API_KEY: apiKey,
    RELEASE_E2E_E2B_TEAM_ID: config.teamId,
  };
  await cleanupSharedTemplateProviderResources(
    receipt.templateId,
    {
      listSandboxes: (templateId) => listProviderSandboxesByTemplate(templateId, providerEnv),
      killSandbox: (providerSandboxId) => killProviderSandbox(providerSandboxId, providerEnv),
      deleteTemplate: (templateId) => builder.deleteTemplate(templateId, config),
      listTemplates: () => listProviderTemplates(providerEnv),
    },
    SHARED_TEMPLATE_CLEANUP_POLICY,
  );
}

/**
 * Constructs the world per the ordered startup steps (spec "World
 * construction"): run/shard-scoped dirs + cleanup ledger + subdomain allocation
 * → preflight LiteLLM (zero side effects on failure) → provision the EC2
 * ingress box (registered-before-create) → deploy the exact Server image + Caddy
 * TLS + Route53 A record and produce the candidate-api receipt → build + publish
 * the immutable E2B template baking the four musl binaries under `/home/user/...`
 * and produce the template receipt → serve the Desktop renderer against the
 * public candidate API origin + launch Chromium → bounded readiness (public TLS
 * `/health`, template receipt verified, authenticated renderer boot). The user's
 * sandbox is NOT pre-created.
 *
 * On any startup failure, every registered cleanup runs exactly once in reverse
 * order, then rethrows (spec failure table).
 */
export async function constructManagedCloudWorld(
  options: ConstructManagedCloudWorldOptions,
): Promise<ManagedCloudWorld> {
  const deps = options.deps ?? {};
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs;

  // Resolve the six required artifacts BEFORE any side effect: an invalid map
  // provisions no AWS box, template, renderer, or browser.
  const candidateSet = resolveCloudCandidateSet(options.map);

  const litellmFetch: FetchLike = deps.litellmFetch ?? ((url, init) =>
    fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const gateway = new QualificationLiteLlmController(options.litellm, { fetch: litellmFetch });
  // Fail fast on unreachable/ineligible gateway access with zero world side
  // effects (spec: no world on invalid shared-service access).
  await gateway.preflight();

  const runDir = options.runDir;
  const artifactsDir = path.join(runDir, "artifacts");
  const secretsDir = path.join(runDir, "secrets");
  const rendererDir = path.join(runDir, "renderer");
  const logsDir = path.join(runDir, "logs");
  const cacheDir = path.join(runDir, "template-cache");
  for (const dir of [runDir, artifactsDir, rendererDir, logsDir, cacheDir]) {
    await mkdir(dir, { recursive: true });
  }
  // The secrets directory (run-owned key files + generated 0600 env files) is
  // owner-only (0700 dir; files inside are written 0600).
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });

  // The subdomain MUST match the one the build baked into the Desktop renderer
  // (VITE_PROLIFERATE_API_BASE_URL) — otherwise the browser calls a host with no
  // DNS record. The build writes it to a sidecar next to the candidate map; that
  // is the single source of truth. Fall back to the local formula only when the
  // sidecar is absent (unit tests construct the world without a build step).
  const subdomain =
    (await readBuildSubdomain(runDir)) ?? allocateSubdomain(options.run, options.aws.zoneName);
  const rendererPort = deps.rendererPort ?? (await allocateEphemeralPort());
  const rendererOrigin = `http://127.0.0.1:${rendererPort}`;

  const ledger = await openCleanupLedger({
    runDir,
    runId: options.run.run_id,
    shardId: options.run.shard_id,
    mirror: deps.ledgerMirror,
  });
  const stack = new ManagedCloudCleanupStack({ ledger, log });

  const register = async (
    kind: ManagedCloudCleanupKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void> => {
    const entryId = await stack.register(kind, release);
    await stack.acquired(entryId, providerId);
  };

  // Two-phase durable registration: `stack.register` writes the intent record
  // (providerId null) durably, then we `acquired(entryId, intentRef)` so the
  // recovery identity lands on disk BEFORE the caller's create; the returned
  // `markAcquired` durably replaces it with the real provider id afterward.
  const registerCleanupIntent = async (
    kind: ManagedCloudCleanupKind,
    intentRef: string,
    release: () => Promise<void>,
  ): Promise<CleanupIntentHandle> => {
    const entryId = await stack.register(kind, release);
    await stack.acquired(entryId, intentRef);
    return {
      entryId,
      markAcquired: (realProviderId: string) => stack.acquired(entryId, realProviderId),
    };
  };
  const trackedActors = new Map<string, { fingerprint: string; promise: Promise<void> }>();
  const trackResolvedActor = (actor: ActorKeyIdentity): Promise<void> =>
    trackActorSubjects(stack, gateway, actor, trackedActors);

  try {
    // Register durable-path + reservation releasers first so they tear down
    // LAST (reverse order), after every cloud/provider resource above them.
    await register("run_directory", runDir, () => rm(runDir, { recursive: true, force: true }));
    await register("port_registration", subdomain, async () => undefined); // subdomain reservation record.
    await register("secret_env_file", secretsDir, () => rm(secretsDir, { recursive: true, force: true }));

    // Materialize + re-hash the six mapped artifacts into run storage.
    const serverArtifact = await materialize(candidateSet.server.artifact_id, options.map, artifactsDir);
    const anyharnessArtifact = await materialize(candidateSet.anyharness.artifact_id, options.map, artifactsDir);
    const workerArtifact = await materialize(candidateSet.worker.artifact_id, options.map, artifactsDir);
    const supervisorArtifact = await materialize(candidateSet.supervisor.artifact_id, options.map, artifactsDir);
    const credentialHelperArtifact = await materialize(
      candidateSet.credentialHelper.artifact_id,
      options.map,
      artifactsDir,
    );
    const rendererArtifact = await materialize(candidateSet.desktopRenderer.artifact_id, options.map, artifactsDir);

    const templateInputs: ManagedCloudTemplateInputs = {
      anyharness: anyharnessArtifact,
      worker: workerArtifact,
      supervisor: supervisorArtifact,
      credentialHelper: credentialHelperArtifact,
      bootstrapInputs: [],
      agentKinds: options.agentKinds ?? DEFAULT_AGENT_KINDS,
    };
    const templateInputHash = await computeManagedCloudTemplateHash(templateInputs);
    const templateCustody = options.templateCustody ?? { mode: "world_owned" as const };
    const sharedTemplateIdentity: SharedTemplateCustodyIdentityV1 = {
      runId: options.run.run_id,
      shardId: options.run.shard_id,
      sourceSha: options.run.source_sha,
      templateName: options.e2b.templateName,
      inputHash: templateInputHash,
    };
    let consumedSharedTemplate: E2bTemplateReceipt | null = null;
    if (templateCustody.mode === "shared_consumer") {
      const custody = await loadSharedTemplateCustody(templateCustody.journalPath, sharedTemplateIdentity);
      if (custody.state !== "acquired" || !custody.receipt) {
        throw new Error("shared managed-cloud template custody is not acquired and cannot be consumed.");
      }
      consumedSharedTemplate = custody.receipt;
    }

    // Provision the run-scoped EC2 ingress (key pair → SG → instance → Route53),
    // every resource registered-before-create through the two-phase ledger.
    const tags: Ec2ResourceTags = {
      purpose: "managed-cloud-qualification",
      runId: options.run.run_id,
      shardId: options.run.shard_id,
    };
    const provisioner = deps.ec2Provisioner ?? new AwsCliEc2Provisioner();
    const ssh = deps.ssh ?? defaultSshExec;
    const { box, record } = await provisionRunIngress({
      config: options.aws,
      tags,
      subdomain,
      provisioner,
      register: (kind, release) => stack.register(kind, release),
      acquired: (entryId, providerId) => stack.acquired(entryId, providerId),
      keyPath: path.join(secretsDir, "ingress-key.pem"),
      timeoutMs,
      log,
    });

    // Deploy the exact Server image + Caddy TLS; produce the candidate-api receipt.
    const publicOrigin = `https://${record.recordName}`;
    const candidateApi = await deployCandidateApi({
      box,
      record,
      serverArtifact,
      litellm: options.litellm,
      github: options.github,
      e2b: options.e2b,
      qualificationRun: { runId: options.run.run_id, shardId: options.run.shard_id },
      // PR 6 (append-only): forwarded verbatim; both undefined by default, so
      // deployCandidateApi's absent-config path (today's behaviour) runs.
      stripe: options.stripe,
      callbackRelay: options.callbackRelay,
      // Thread the world's own cleanup stack so the relay's process + spool are
      // registered-before-create in the SAME ledger as every other resource,
      // released in reverse order by close(). Only invoked when callbackRelay is
      // present; absent, deployCandidateApi never calls it.
      registerCleanup: (kind, providerId, release) => register(kind, providerId, release),
      publicOrigin,
      rendererOrigin,
      secretsDir,
      setupTokenHostPath: path.join(runDir, SETUP_TOKEN_FILENAME),
      ssh,
      probeHealth: deps.probeHealth ?? pinnedHttpsHealthProbe(record.address),
      timeoutMs,
      log,
    });
    const candidateBox = createBoxExec({
      ssh,
      destination: box.sshDestination,
      keyPath: box.keyPath,
      secretsDir,
      log,
    });

    // Build/publish (normal/producer) or consume (second proof) the immutable
    // E2B template. Shared producer custody is durable before provider create;
    // the consumer validates source/input identity before any AWS side effect
    // above, then becomes the final deletion owner.
    const resolveTemplate = deps.resolveTemplate ?? resolveOrBuildManagedCloudTemplate;
    const templateBuilder = deps.templateBuilder ?? new E2bTemplateBuilder();
    let template: E2bTemplateReceipt;
    if (templateCustody.mode === "shared_consumer") {
      template = consumedSharedTemplate as E2bTemplateReceipt;
      await register("e2b_template", template.templateId, async () => {
        await (deps.cleanupSharedTemplate ?? cleanupSharedTemplate)(
          template,
          options.e2b,
          templateBuilder,
        );
        await markSharedTemplateReleased(
          templateCustody.journalPath,
          sharedTemplateIdentity,
          template,
        );
      });
    } else {
      if (templateCustody.mode === "shared_producer") {
        await recordSharedTemplateIntent(templateCustody.journalPath, sharedTemplateIdentity);
      }
      template = await resolveTemplate({
        inputs: templateInputs,
        config: options.e2b,
        builder: templateBuilder,
        register:
          templateCustody.mode === "world_owned"
            ? (providerId, release) => register("e2b_template", providerId, release)
            : async () => undefined,
        cacheDir,
        log,
      });
      if (templateCustody.mode === "shared_producer") {
        await markSharedTemplateAcquired(
          templateCustody.journalPath,
          sharedTemplateIdentity,
          template,
        );
      }
    }
    if (!template.templateId || !template.buildId) {
      throw new Error("managed-cloud template receipt is missing provider template/build ids.");
    }

    // Serve the Desktop renderer (built with the public API origin baked in)
    // against a local port + launch the shared Chromium browser.
    const extracted = await extractRenderer(rendererArtifact, rendererDir, { exec: deps.extractExec });
    let served: Awaited<ReturnType<typeof serveRenderer>> | null = null;
    const rendererEntry = await stack.register("renderer_process", async () => {
      await served?.process.terminate();
    });
    // Persist the unique run-directory marker before spawn. If the runner dies
    // between spawn and exact PID capture, the fresh replayer can still find
    // only this run's renderer command line.
    await stack.acquired(rendererEntry, `${RENDERER_PROCESS_INTENT_PREFIX}${rendererDir}`);
    served = await serveRenderer({
      extracted,
      host: "127.0.0.1",
      port: rendererPort,
      timeoutMs,
      log,
      spawn: deps.spawn,
      fetch: deps.rendererFetch,
    });
    const rendererProcessIdentity = await captureHostProcessCustody(
      served.process.child.pid,
      rendererDir,
    ).catch(() => null);
    await stack.acquired(
      rendererEntry,
      rendererProcessIdentity ?? `${RENDERER_PROCESS_INTENT_PREFIX}${rendererDir}`,
    );

    // Pin the run subdomain to the box IP inside Chromium too — the laptop
    // resolver's observed NXDOMAIN flaps would otherwise break the renderer's
    // API calls mid-scenario. TLS/SNI still validate the real LE certificate.
    let browser: Browser | null = null;
    const browserEntry = await stack.register("browser", async () => {
      await browser?.close();
    });
    // Browser launch has no caller-controlled profile path in Playwright's
    // non-persistent API. Persist a non-actionable intent before creation; once
    // launch returns, immediately replace it with PID/starttime/profile custody.
    // A crash in that tiny gap stays non-green rather than killing by PID alone.
    await stack.acquired(browserEntry, `process-intent:browser:${runDir}`);
    browser = await launchChromium({
      log,
      launcher: deps.chromiumLauncher,
      args: [`--host-resolver-rules=MAP ${subdomain} ${record.address}`],
    });
    const browserProcessIdentity = await capturePlaywrightBrowserCustody(process.pid).catch(() => null);
    await stack.acquired(
      browserEntry,
      browserProcessIdentity ?? `process-intent:browser:${runDir}`,
    );

    log(`managed-cloud world ready (run ${options.run.run_id}/${options.run.shard_id} @ ${publicOrigin})`);

    return {
      kind: "managed-cloud",
      run: options.run,
      artifacts: {
        server: serverArtifact,
        anyharness: anyharnessArtifact,
        worker: workerArtifact,
        supervisor: supervisorArtifact,
        credentialHelper: credentialHelperArtifact,
        desktopRenderer: rendererArtifact,
        template,
        candidateApi,
      },
      api: { baseUrl: candidateApi.publicOrigin, client: new ApiClient({ baseUrl: candidateApi.publicOrigin }) },
      renderer: { baseUrl: served.baseUrl, browser },
      gateway,
      sandbox: { e2bTeamId: options.e2b.teamId },
      box: candidateBox,
      paths: { runDir, secretsDir },
      registerCleanup: register,
      registerCleanupIntent,
      trackActorSubjects: trackResolvedActor,
      resolveAndTrackActorSubjects: async (params) => {
        const actor = await gateway.resolveActorKey(params);
        await trackResolvedActor(actor);
        return actor;
      },
      beginActorEnrollmentCustody: (params) => beginActorEnrollmentCustody(
        stack,
        gateway,
        candidateBox,
        options.litellm,
        litellmFetch,
        options.run,
        params.email,
        trackedActors,
      ),
      close: async () => {
        const cleanup = await stack.runAll();
        if (templateCustody.mode === "shared_producer") {
          const custody = await loadSharedTemplateCustody(
            templateCustody.journalPath,
            sharedTemplateIdentity,
          );
          assertSharedTemplateCustodyAcquired(custody, template);
          return {
            ...cleanup,
            templateDeleted: false,
            templateCustodyTransferred: true,
          };
        }
        return { ...cleanup, templateCustodyTransferred: false };
      },
    };
  } catch (error) {
    // Any startup failure runs every registered cleanup exactly once, reverse
    // order. A cleanup failure is part of the terminal error; swallowing it can
    // strand provider resources while the report names only the startup cause.
    try {
      const cleanup = await stack.runAll();
      if (cleanup.failed > 0) {
        throw new Error(`startup cleanup left ${cleanup.failed} unreconciled resource(s)`);
      }
    } catch (cleanupError) {
      const startupMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new AggregateError(
        [error, cleanupError],
        `managed-cloud startup failed: ${startupMessage}; cleanup also failed: ${cleanupMessage}`,
      );
    }
    throw error;
  }
}

async function beginActorEnrollmentCustody(
  stack: ManagedCloudCleanupStack,
  gateway: QualificationLiteLlmController,
  box: BoxExec,
  litellm: QualificationLiteLlmConfig,
  litellmFetch: FetchLike,
  run: RunIdentityV1,
  email: string,
  tracked: Map<string, { fingerprint: string; promise: Promise<void> }>,
): Promise<{
  resolveAndTrack(params: { userId: string; enrollmentId: string }): Promise<ActorKeyIdentity>;
}> {
  const replayInputs = {
    litellmBaseUrl: litellm.adminBaseUrl,
    litellmMasterKey: litellm.masterKey,
  };
  const intent = actorEnrollmentIntent(run, email);
  let binding: RecoveredActorEnrollmentV1 | undefined;
  let custodyPublished = false;
  const entryId = await stack.register("litellm_actor_enrollment", async () => {
    if (!custodyPublished) {
      // beginActorEnrollmentCustody has not returned, so its caller cannot
      // have started /setup or invite registration. This is the sole
      // authoritative no-actor crash window in the live stack.
      return;
    }
    let recovered;
    if (binding) {
      recovered = binding;
    } else {
      const resolved = await resolveActorEnrollmentOnBox(box, intent);
      if (resolved.status !== "recovered") {
        throw new Error(
          `LiteLLM actor enrollment producer is not quiescent (${resolved.status}); preserving candidate recovery substrate.`,
        );
      }
      recovered = resolved.binding;
    }
    const exact = await resolveActorEnrollmentProviderBinding(recovered, replayInputs, litellmFetch);
    binding = exact;
    // Make the recovery substrate dispensable BEFORE any provider delete. If
    // a later LiteLLM call fails, fresh replay has all personal + organization
    // actor keys/teams and may safely tear down the candidate box.
    await stack.acquired(entryId, encodeActorEnrollmentCustody(exact));
    await deleteActorEnrollmentSubjects(
      exact,
      replayInputs,
      litellmFetch,
      (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    );
  });
  await stack.acquired(entryId, encodeActorEnrollmentCustody(intent));
  custodyPublished = true;

  return {
    async resolveAndTrack(params) {
      const resolved = await gateway.resolveActorKey(params);
      bindActorEnrollment(intent, resolved); // validates the public personal enrollment response
      const deadline = Date.now() + 60_000;
      let actorSet: ActorEnrollmentLookup;
      do {
        actorSet = await resolveActorEnrollmentOnBox(box, intent);
        if (actorSet.status === "recovered") break;
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      } while (Date.now() < deadline);
      if (actorSet.status !== "recovered") {
        throw new Error(
          `LiteLLM actor enrollment set did not quiesce before custody handoff (${actorSet.status}).`,
        );
      }
      binding = await resolveActorEnrollmentProviderBinding(actorSet.binding, replayInputs, litellmFetch);
      // Promote only after BOTH personal and organization enrollment sets are
      // synced and all current/retry-orphan provider keys are durably named.
      await stack.acquired(entryId, encodeActorEnrollmentCustody(binding));
      const fingerprint = [
        resolved.userId, resolved.enrollmentId, resolved.litellmUserId,
        resolved.teamId, resolved.tokenIdHash,
      ].join("\u0000");
      const existing = tracked.get(resolved.keyAlias);
      if (existing && existing.fingerprint !== fingerprint) {
        throw new Error(`LiteLLM cleanup alias "${resolved.keyAlias}" resolved to conflicting actor identities.`);
      }
      tracked.set(resolved.keyAlias, { fingerprint, promise: Promise.resolve() });
      return resolved;
    },
  };
}

async function materialize(
  artifactId: string,
  map: CandidateBuildMapV1,
  storageDir: string,
): Promise<MaterializedArtifact> {
  const artifact = map.artifacts.find((entry) => entry.artifact_id === artifactId);
  if (!artifact) {
    throw new Error(`Candidate map lost artifact "${artifactId}" between resolution and materialization.`);
  }
  const materializedPath = await materializeLocalArtifact(artifact, storageDir);
  return { artifact_id: artifact.artifact_id, version: artifact.version, sha256: artifact.sha256, path: materializedPath };
}

/** Registers the three LiteLLM subject deletions, de-duplicated across entries. */
async function trackActorSubjects(
  stack: ManagedCloudCleanupStack,
  gateway: QualificationLiteLlmController,
  actor: ActorKeyIdentity,
  tracked: Map<string, { fingerprint: string; promise: Promise<void> }>,
): Promise<void> {
  const fingerprint = [
    actor.userId,
    actor.enrollmentId,
    actor.litellmUserId,
    actor.teamId,
    actor.tokenIdHash,
  ].join("\u0000");
  const existing = tracked.get(actor.keyAlias);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new Error(`LiteLLM cleanup alias "${actor.keyAlias}" resolved to conflicting actor identities.`);
    }
    return existing.promise;
  }
  const promise = registerActorSubjects(stack, gateway, actor);
  tracked.set(actor.keyAlias, { fingerprint, promise });
  // Keep even a rejected registration promise pinned to this alias. A partial
  // ledger write must fail the run and be replayed; retrying registration here
  // would create a second destructive path for the same provider subjects.
  await promise;
}

async function registerActorSubjects(
  stack: ManagedCloudCleanupStack,
  gateway: QualificationLiteLlmController,
  actor: ActorKeyIdentity,
): Promise<void> {
  let result: ActorSubjectsDeletion | undefined;
  const ensure = async (): Promise<ActorSubjectsDeletion> => {
    if (!result) {
      result = await gateway.deleteActorSubjects(actor);
    }
    return result;
  };
  // Registered last → released FIRST (reverse order), before local teardown.
  const teamEntry = await stack.register("litellm_team", async () => {
    if (!(await ensure()).litellmSubjectsDeleted) {
      throw new Error("LiteLLM team was not deleted.");
    }
  });
  await stack.acquired(teamEntry, actor.teamId || `missing-team:${actor.userId}`);
  const userEntry = await stack.register("litellm_user", async () => {
    if (!(await ensure()).litellmSubjectsDeleted) {
      throw new Error("LiteLLM user was not deleted.");
    }
  });
  await stack.acquired(userEntry, actor.litellmUserId);
  const keyEntry = await stack.register("litellm_virtual_key", async () => {
    if (!(await ensure()).virtualKeyDeleted) {
      throw new Error("LiteLLM virtual key was not deleted.");
    }
  });
  // Persist only the safe deterministic alias (never the raw token). A fresh
  // crash-replay process can re-resolve the exact token by alias and delete it;
  // the prior tokenIdHash was evidence-safe but not independently actionable.
  await stack.acquired(keyEntry, `key-alias:${actor.keyAlias}`);
}

/**
 * The subdomain the build allocated and compiled into the renderer's API base
 * URL, read from the `cloud-world-subdomain.json` sidecar the build writes next
 * to the candidate map. Returns null when the sidecar is absent or malformed.
 */
async function readBuildSubdomain(runDir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(runDir, "cloud-world-subdomain.json"), "utf8");
    const parsed = JSON.parse(raw) as { subdomain?: unknown };
    return typeof parsed.subdomain === "string" && parsed.subdomain.length > 0 ? parsed.subdomain : null;
  } catch {
    return null;
  }
}

/** `<run>.<zone>` subdomain, lowercase and DNS-label-safe (spec step 1). */
function allocateSubdomain(run: RunIdentityV1, zoneName: string): string {
  const label = `mcq-${run.run_id}-${run.shard_id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${label}.${zoneName}`;
}

/** Binds an ephemeral loopback port and returns it (for the local renderer server). */
async function allocateEphemeralPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("could not allocate an ephemeral port"))));
    });
  });
}

/** Default public-TLS `/health` probe (real `fetch`; faked in unit tests). */
const defaultHttpsHealthProbe = async (origin: string): Promise<{ ok: boolean; version: string }> => {
  const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    return { ok: false, version: "" };
  }
  const body = (await response.json()) as { version?: unknown };
  return { ok: true, version: String(body.version ?? "") };
};

/**
 * Health probe pinned to the box's known public IP: TCP connects to the IP
 * while presenting the run subdomain as SNI + Host, so real TLS (Let's
 * Encrypt cert for the exact name) and the exact Server version are still
 * proven — without depending on the runner laptop's resolver, which was
 * observed intermittently dropping fresh names (~30% NXDOMAIN flaps) while
 * the authoritative zone answered correctly. Name existence is separately
 * guaranteed by the world's own Route53 upsert.
 */
function pinnedHttpsHealthProbe(address: string): (origin: string) => Promise<{ ok: boolean; version: string }> {
  return async (origin: string) => {
    const { hostname } = new URL(origin);
    const { request } = await import("node:https");
    return await new Promise((resolve) => {
      const req = request(
        {
          host: address,
          servername: hostname,
          port: 443,
          path: "/health",
          method: "GET",
          headers: { Host: hostname },
          timeout: 5_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            if ((res.statusCode ?? 0) !== 200) {
              resolve({ ok: false, version: "" });
              return;
            }
            try {
              const body = JSON.parse(data) as { version?: unknown };
              resolve({ ok: true, version: String(body.version ?? "") });
            } catch {
              resolve({ ok: false, version: "" });
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("health probe timeout")));
      req.on("error", () => resolve({ ok: false, version: "" }));
      req.end();
    });
  };
}
