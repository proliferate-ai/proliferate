import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "playwright";

import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import {
  resolveLocalCandidateSet,
  type MaterializedArtifact,
} from "../../artifacts/local-candidate-set.js";
import { materializeLocalArtifact } from "../../artifacts/materialize-local.js";
import { ApiClient } from "../../fixtures/http.js";
import { LocalRuntimeClient } from "../../fixtures/local-runtime.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import {
  QualificationLiteLlmController,
  type ActorKeyIdentity,
  type ActorSubjectsDeletion,
  type FetchLike,
  type QualificationLiteLlmConfig,
} from "../../services/qualification-litellm.js";
import { LocalWorldCleanupStack, type LocalWorldCleanupEvidence } from "./cleanup.js";
import {
  openCleanupLedger,
  type CleanupLedgerMirror,
  type CleanupResourceKind,
} from "./cleanup-ledger.js";
import {
  dockerInternalUrls,
  startDockerStack,
  type DockerNaming,
  type DockerResourceKind,
  type Exec,
  type ServerContainerEnv,
} from "./docker.js";
import { launchAnyharness, type ReadinessFetch, type SpawnLike } from "./processes.js";
import type { LocalWorldPorts } from "./ports.js";
import { extractRenderer, launchChromium, serveRenderer, type ChromiumLauncher } from "./renderer.js";

export type { LocalWorldPorts } from "./ports.js";

/**
 * Container path the candidate Server writes its plaintext first-run setup
 * token to (`SETUP_TOKEN_FILE`, see `server/proliferate/config.py`). Set to a
 * container-writable path (not the packaged default `/var/lib/...`, which the
 * image's runtime user cannot create) so the world can copy the token out to
 * `<runDir>/setup-token` for the actor fixture's real `/setup` claim.
 */
export const SERVER_SETUP_TOKEN_CONTAINER_PATH = "/tmp/proliferate-setup/setup-token";

/** Host filename the setup token is copied to under the run directory. */
export const SETUP_TOKEN_FILENAME = "setup-token";

/**
 * The reusable local-world constructor (spec "Local-world contract"). It
 * consumes validated artifacts, resolved LiteLLM access, and the run identity,
 * and returns a ready typed handle — not a bag of environment variables.
 * Secrets and privileged database/provider methods stay private inside the
 * world/controller; scenario code receives only product clients, endpoints, the
 * browser, safe identity helpers, and the cleanup interface it needs.
 *
 * The same TypeScript code runs locally and in GitHub Actions.
 */
export interface ReadyLocalWorld {
  kind: "local-workspace";
  run: RunIdentityV1;

  artifacts: {
    server: MaterializedArtifact;
    anyharness: MaterializedArtifact;
    desktopRenderer: MaterializedArtifact;
  };

  api: {
    baseUrl: string;
    client: ApiClient;
  };

  runtime: {
    baseUrl: string;
    client: LocalRuntimeClient;
  };

  renderer: {
    baseUrl: string;
    browser: Browser;
  };

  gateway: QualificationLiteLlmController;

  paths: {
    runDir: string;
    runtimeHome: string;
    repositoriesDir: string;
  };

  /**
   * Registers a durable, reverse-order cleanup releaser for a resource a fixture
   * or scenario creates on top of the world (e.g. a per-actor browser context or
   * a run-scoped repository clone). Additive seam beyond the spec's field list —
   * fixtures need it to enrol their own resources into the world's single
   * ledgered teardown. Runs during `close()`.
   */
  registerCleanup?(
    kind: CleanupResourceKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void>;

  /**
   * Enrols the actor's LiteLLM virtual key + user + team for deletion during
   * `close()`, ordered BEFORE local database teardown so the deterministic alias
   * stays recoverable (spec "Cleanup"). The three subjects are one atomic
   * `deleteActorSubjects` call de-duplicated across the three ledger entries so
   * the evidence booleans (`virtualKeyDeleted`, `litellmSubjectsDeleted`) are
   * populated. Additive seam beyond the spec's field list; the actor identity
   * only exists after enrolment, so it cannot be known at construction.
   */
  trackActorSubjects?(actor: ActorKeyIdentity): Promise<void>;

  close(): Promise<LocalWorldCleanupEvidence>;
}

/**
 * Everything the constructor needs. `map` is the validated, path-bearing
 * `CandidateBuildMapV1` (in-memory only; never serialized). `litellm` carries
 * the typed, preflighted access. `runDir`/ports are the run/shard-scoped
 * layout allocated before world startup.
 */
export interface ConstructLocalWorldOptions {
  run: RunIdentityV1;
  map: CandidateBuildMapV1;
  litellm: QualificationLiteLlmConfig;
  /** Run/shard-scoped root; all world state lives under here. */
  runDir: string;
  /** Pre-allocated non-conflicting ports for server/postgres/redis/anyharness/renderer. */
  ports: LocalWorldPorts;
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Injectable seams; all default to the real world. Unit tests pass fakes so
   * no real container, browser, or network is touched. */
  deps?: LocalWorldDeps;
}

export interface LocalWorldDeps {
  litellmFetch?: FetchLike;
  dockerExec?: Exec;
  readinessFetch?: ReadinessFetch;
  spawn?: SpawnLike;
  chromiumLauncher?: ChromiumLauncher;
  extractExec?: Exec;
  ledgerMirror?: CleanupLedgerMirror;
}

/**
 * Constructs the world per the 10 ordered startup steps: run-scoped dirs/ports
 * → materialize+re-hash the three artifacts → load the exact Server image →
 * fresh Postgres/Redis on a run-specific project/network → migrate with the
 * exact image → start the exact Server (gateway + short enrollment interval) →
 * launch the exact host AnyHarness (isolated home, no ambient credentials) →
 * extract+serve the exact renderer → launch Chromium → bounded readiness for
 * all four. Reported Server and AnyHarness versions are verified against the
 * candidate map; the renderer identity is its archive hash plus a successful
 * boot.
 *
 * On any startup failure, every registered cleanup runs exactly once in reverse
 * order (spec failure table).
 */
export async function constructLocalWorld(options: ConstructLocalWorldOptions): Promise<ReadyLocalWorld> {
  const deps = options.deps ?? {};
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs;

  // Resolve the required three artifacts BEFORE any side effect: an invalid map
  // starts no database, Server, AnyHarness, renderer, or browser.
  const candidateSet = resolveLocalCandidateSet(options.map);

  const gateway = new QualificationLiteLlmController(options.litellm, { fetch: deps.litellmFetch });
  // Fail fast on unreachable/ineligible gateway access with zero world side
  // effects (spec: no world on invalid shared-service access).
  await gateway.preflight();

  const runDir = options.runDir;
  const artifactsDir = path.join(runDir, "artifacts");
  const rendererDir = path.join(runDir, "renderer");
  const runtimeHome = path.join(runDir, "runtime-home");
  const repositoriesDir = path.join(runDir, "repositories");
  const logsDir = path.join(runDir, "logs");
  for (const dir of [runDir, artifactsDir, rendererDir, runtimeHome, repositoriesDir, logsDir]) {
    await mkdir(dir, { recursive: true });
  }

  const ledger = await openCleanupLedger({
    runDir,
    runId: options.run.run_id,
    shardId: options.run.shard_id,
    mirror: deps.ledgerMirror,
  });
  const stack = new LocalWorldCleanupStack({ ledger, log });

  const register = async (
    kind: CleanupResourceKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void> => {
    const entryId = await stack.register(kind, release);
    await stack.acquired(entryId, providerId);
  };

  try {
    // Register durable-path + reservation releasers first so they tear down
    // LAST (reverse order), after every container/process that lives under them.
    await register("run_directory", runDir, () => rm(runDir, { recursive: true, force: true }));
    await register(
      "port_registration",
      [options.ports.server, options.ports.postgres, options.ports.redis, options.ports.anyharness, options.ports.renderer].join(","),
      async () => undefined, // ephemeral OS ports; the record exists for crash recovery, not a real release.
    );
    await register("runtime_home", runtimeHome, () => rm(runtimeHome, { recursive: true, force: true }));
    await register("extracted_artifacts", artifactsDir, async () => {
      await rm(artifactsDir, { recursive: true, force: true });
      await rm(rendererDir, { recursive: true, force: true });
    });

    // Step 2: materialize + re-hash the three mapped artifacts into run storage.
    const serverArtifact = await materialize(candidateSet.server.artifact_id, options.map, artifactsDir);
    const anyharnessArtifact = await materialize(candidateSet.anyharness.artifact_id, options.map, artifactsDir);
    const rendererArtifact = await materialize(candidateSet.desktopRenderer.artifact_id, options.map, artifactsDir);

    // Steps 3–6: run-scoped Docker network + Postgres + Redis + migrations +
    // Server (gateway enabled, SINGLE_ORG_MODE, short backfill interval).
    const naming = dockerNaming(options.run.run_id, options.run.shard_id);
    const serverEnv = buildServerEnv(naming, options.litellm, options.ports.renderer);
    const setupTokenHostPath = path.join(runDir, SETUP_TOKEN_FILENAME);
    const server = await startDockerStack({
      naming,
      ports: { server: options.ports.server, postgres: options.ports.postgres, redis: options.ports.redis },
      serverArtifact,
      serverEnv,
      // The real Server mints the first-run token at boot and writes the
      // plaintext to SETUP_TOKEN_FILE inside the container; the world copies it
      // out to <runDir>/setup-token so the actor fixture claims through the real
      // /setup path (no bypass).
      setupTokenContainerPath: SERVER_SETUP_TOKEN_CONTAINER_PATH,
      setupTokenHostPath,
      registerCleanup: (kind: DockerResourceKind, providerId, release) => register(kind, providerId, release),
      timeoutMs,
      log,
      deps: { exec: deps.dockerExec, fetch: deps.readinessFetch },
    });
    verifyVersion("Server", server.version, serverArtifact.version);

    // Step 7: host AnyHarness with an isolated runtime home and hermetic env.
    const anyharness = await launchAnyharness({
      binaryPath: anyharnessArtifact.path,
      host: "127.0.0.1",
      port: options.ports.anyharness,
      runtimeHome,
      timeoutMs,
      log,
      spawn: deps.spawn,
      fetch: deps.readinessFetch,
    });
    await register("anyharness_process", `pid:${anyharness.process.child.pid ?? "unknown"}`, () =>
      anyharness.process.terminate(),
    );
    verifyVersion("AnyHarness", anyharness.health.version, anyharnessArtifact.version);

    // Step 8: extract + statically serve the exact renderer bytes.
    const extracted = await extractRenderer(rendererArtifact, rendererDir, { exec: deps.extractExec });
    const served = await serveRenderer({
      extracted,
      host: "127.0.0.1",
      port: options.ports.renderer,
      timeoutMs,
      log,
      spawn: deps.spawn,
      fetch: deps.readinessFetch,
    });
    await register("renderer_process", `pid:${served.process.child.pid ?? "unknown"}`, () =>
      served.process.terminate(),
    );

    // Step 9: shared Chromium browser.
    const browser = await launchChromium({ log, launcher: deps.chromiumLauncher });
    await register("browser", "chromium", () => browser.close());

    log(`local world ready (run ${options.run.run_id}/${options.run.shard_id})`);

    return {
      kind: "local-workspace",
      run: options.run,
      artifacts: { server: serverArtifact, anyharness: anyharnessArtifact, desktopRenderer: rendererArtifact },
      api: { baseUrl: server.baseUrl, client: new ApiClient({ baseUrl: server.baseUrl }) },
      runtime: { baseUrl: anyharness.baseUrl, client: new LocalRuntimeClient({ baseUrl: anyharness.baseUrl }) },
      renderer: { baseUrl: served.baseUrl, browser },
      gateway,
      paths: { runDir, runtimeHome, repositoriesDir },
      registerCleanup: register,
      trackActorSubjects: (actor) => trackActorSubjects(stack, gateway, actor),
      close: () => stack.runAll(),
    };
  } catch (error) {
    // Any startup failure runs every registered cleanup exactly once, reverse
    // order, then rethrows so the caller marks the cell failed.
    await stack.runAll().catch(() => undefined);
    throw error;
  }
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
  stack: LocalWorldCleanupStack,
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
  // Registered last → released FIRST (reverse order), before the DB/containers.
  const teamEntry = await stack.register("litellm_team", async () => {
    if (!(await ensure()).litellmSubjectsDeleted) {
      throw new Error("LiteLLM team was not deleted.");
    }
  });
  await stack.acquired(teamEntry, actor.teamId || "team");
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
  await stack.acquired(keyEntry, actor.tokenIdHash);
}

function dockerNaming(runId: string, shardId: string): DockerNaming {
  const project = `plq-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
  return { project, network: `${project}-net` };
}

function buildServerEnv(
  naming: DockerNaming,
  litellm: QualificationLiteLlmConfig,
  rendererPort: number,
): ServerContainerEnv {
  const { databaseUrl, redisUrl } = dockerInternalUrls(naming);
  return {
    SINGLE_ORG_MODE: "true",
    AGENT_GATEWAY_ENABLED: "true",
    // The renderer is served over http on its own ephemeral port (in production
    // the Desktop app is a Tauri custom-scheme origin the default list covers).
    // Allow that exact origin so the browser's cross-origin calls to the Server
    // are not blocked by CORS.
    CORS_ALLOW_ORIGINS: `http://127.0.0.1:${rendererPort},http://localhost:${rendererPort}`,
    AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS: "5",
    AGENT_GATEWAY_LITELLM_BASE_URL: litellm.adminBaseUrl,
    AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: litellm.publicBaseUrl,
    AGENT_GATEWAY_LITELLM_MASTER_KEY: litellm.masterKey,
    // The candidate Server runs in production posture (debug=False), which
    // requires these instance secrets to be set to non-default values (see
    // server/proliferate/config.py `validate_secrets_in_production`). Fresh
    // run-scoped random values keep the exact production posture rather than
    // flipping DEBUG on. Both the migration one-off and the Server container
    // build Settings, so both consume this same env.
    JWT_SECRET: randomBytes(32).toString("hex"),
    CLOUD_SECRET_KEY: randomBytes(32).toString("hex"),
    // Container-writable token path so the real first-run token file is
    // produced somewhere the image's runtime user can create and the world can
    // copy out (the packaged /var/lib default is not runtime-writable).
    SETUP_TOKEN_FILE: SERVER_SETUP_TOKEN_CONTAINER_PATH,
    DATABASE_URL: databaseUrl,
    REDBEAT_REDIS_URL: redisUrl,
  };
}

function verifyVersion(component: string, reported: string, expected: string): void {
  if (reported !== expected) {
    throw new Error(
      `${component} reported version "${reported}" does not match the candidate map version "${expected}".`,
    );
  }
}
