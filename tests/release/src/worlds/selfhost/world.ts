import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Browser } from "playwright";

import { registerCancellationFinalizer } from "../../cli/cancellation-finalizer.js";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import {
  resolveSelfHostCandidateSet,
  type SelfHostCandidateSet,
} from "../../artifacts/selfhost-candidate-set.js";
import { materializeLocalArtifact } from "../../artifacts/materialize-local.js";
import { ApiClient } from "../../fixtures/http.js";
import { LocalRuntimeClient } from "../../fixtures/local-runtime.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import type { LocalWorldPorts } from "../local-workspace/ports.js";
import {
  openCleanupLedger,
  type CleanupLedgerMirror,
} from "../local-workspace/cleanup-ledger.js";
import { launchAnyharness, type ReadinessFetch, type SpawnLike } from "../local-workspace/processes.js";
import { extractRenderer, launchChromium, serveRenderer, type ChromiumLauncher } from "../local-workspace/renderer.js";
import type { Exec } from "../local-workspace/docker.js";
import {
  decodeQualificationTls,
  materializeQualificationTls,
  type QualificationTlsInput,
} from "../qualification-tls.js";
import {
  provisionEc2Box,
  resolveRunnerPublicIp,
  waitForSshAndCloudInit,
  type Ec2Box,
  type Ec2Exec,
  type PublicIpResolver,
} from "./ec2.js";
import { runSubdomainLabel, upsertRoute53ARecord, type Route53Exec } from "./dns.js";
import { SELFHOST_DEPLOY_DIR, SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE } from "./install.js";
import {
  SelfHostCleanupStack,
  type SelfHostCleanupResourceKind,
  type SelfHostWorldCleanupEvidence,
} from "./cleanup-kinds.js";

/**
 * The reusable self-host-world constructor (frozen spec "World construction
 * (ReadySelfHostWorld)"). It mirrors `ReadyLocalWorld`: it consumes validated
 * candidate artifacts and the run identity and returns a ready typed handle, not
 * a bag of environment variables. Secrets (SSH private key material, AWS creds,
 * setup token, BYOK key) stay private inside the world/control handle; cell code
 * receives only product clients, endpoints, the browser, the SSH/SSM control
 * seam it needs, and the cleanup interface.
 *
 * Base-world setup PROVISIONS infra and stands up the controller-local runtime,
 * renderer, and browser — it does NOT run the shipped installer or claim the
 * instance. Install/claim/turn/invite are the behavior under test: the
 * `SELFHOST-INSTALL-1` cells drive `runShippedInstaller` (install.ts) through
 * `control.ssh` and the product APIs. `api.baseUrl` is the deterministic TLS
 * origin of the run subdomain (known once DNS is provisioned; it serves traffic
 * only after the install cell brings the stack up).
 *
 * The same TypeScript code runs locally and in GitHub Actions.
 */
export interface ReadySelfHostWorld {
  kind: "selfhost";
  run: RunIdentityV1;

  artifacts: {
    /** `server/linux/<arch>` docker-save archive, materialized run-local. */
    serverImage: MaterializedArtifact;
    /** `selfhost-bundle/<platform>` proliferate-deploy.tar.gz + its SHA256SUMS. */
    bundle: MaterializedArtifact;
    /** `anyharness/<host-target>` release executable (reused PR 1 build). */
    anyharness: MaterializedArtifact;
    /** `desktop-renderer/browser` archive (reused PR 1 build). */
    desktopRenderer: MaterializedArtifact;
  };

  /** The remote self-host public API, over real Caddy/publicly trusted TLS. */
  api: {
    baseUrl: string;
    client: ApiClient;
  };

  /** The controller-local candidate AnyHarness (NOT on the box). */
  runtime: {
    baseUrl: string;
    client: LocalRuntimeClient;
  };

  /** The isolated candidate Desktop renderer served locally in Chromium. */
  renderer: {
    baseUrl: string;
    browser: Browser;
  };

  /** SSH/SSM control seam to the box (setup token, restart, on-box asserts). */
  control: SelfHostControlHandle;

  paths: {
    runDir: string;
    runtimeHome: string;
    artifactsDir: string;
    /** 0600 SSH private-key file path (the key material is the secret). */
    keyPath: string;
    /** Mode-0600 reusable wildcard certificate staged only into qualification Caddy. */
    tlsCertificatePath: string;
    /** Mode-0600 matching private key; never logged or stored in evidence. */
    tlsPrivateKeyPath: string;
  };

  /**
   * Registers a durable reverse-order releaser for a resource a fixture or cell
   * creates on top of the world (e.g. a per-page browser context). Additive
   * seam beyond the field list; runs during `close()`.
   */
  registerCleanup?(
    kind: SelfHostCleanupResourceKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void>;

  /**
   * Tears down in reverse ledger order (browser, renderer, AnyHarness, Route53
   * record, EC2/SG/key pair, local dirs) and returns the bounded cleanup
   * evidence. Cleanup failure is non-green; the ledger survives cleanup failure
   * (PR 1 semantics).
   */
  close(): Promise<SelfHostWorldCleanupEvidence>;
}

/**
 * The SSH/SSM control handle the world exposes. `ssh` is the low-level
 * transport install.ts / fixtures consume; the higher-level helpers wrap the
 * on-box motions the cells assert. Secrets never pass through argv — the key
 * path is 0600 and any env is written to a 0600 file (frozen spec HARD RULES).
 */
export interface SelfHostControlHandle {
  box: Ec2Box;
  ssh: SshTransport;
  /** Reads the one-time first-run setup token over SSH/SSM (never over HTTP). */
  readSetupToken(): Promise<string>;
  /** Restarts the compose stack on the box (persistence assertion). */
  restartStack(): Promise<void>;
  /** Asserts the running container image digest equals the candidate receipt. */
  assertRunningImageDigest(expectedDigest: string): Promise<string>;
}

/**
 * SSH/SCP transport to the run's box. `scp` transports artifact bytes (server
 * image archive, deploy bundle); `run` executes a bounded command and returns
 * stdout, throwing on non-zero exit. Faked in unit tests.
 */
export interface SshTransport {
  scp(localPath: string, remotePath: string): Promise<void>;
  run(command: string, options?: { timeoutMs?: number }): Promise<string>;
}

/** Typed AWS/SSH world inputs (values sourced from the env manifest; secrets stay 0600). */
export interface SelfHostAwsInputs {
  region: string;
  instanceType: string;
  /** Route53 hosted-zone id for `qualification.proliferate.com`. */
  hostedZoneId: string;
  zone: string;
}

export interface SelfHostSshInputs {
  /** SSH login user on the Ubuntu AMI (default "ubuntu"). */
  sshUser: string;
}

export interface ConstructSelfHostWorldOptions {
  run: RunIdentityV1;
  map: CandidateBuildMapV1;
  /** Run/shard-scoped root; all world state (artifacts, key file, ledger) under here. */
  runDir: string;
  /** Pre-allocated non-conflicting ports (controller AnyHarness + renderer used). */
  ports: LocalWorldPorts;
  aws: SelfHostAwsInputs;
  ssh: SelfHostSshInputs;
  timeoutMs?: number;
  log?: (message: string) => void;
  /**
   * A FIXED DNS subdomain label to upsert the A record under (e.g.
   * `selfhost-fixed`) instead of the default run-scoped
   * {@link runSubdomainLabel}. Used only by the serial `SELFHOST-QUAL-1`
   * SH-GITHUB-AUTH lane, whose GitHub OAuth application has a single fixed
   * registered callback URL and therefore needs a deterministic public origin.
   * The EC2 box / security group / key pair stay run-scoped; only the DNS name
   * (and thus `api.baseUrl`) is fixed. A serial lane guarantees no two runs
   * upsert this same record concurrently. When absent, the origin is the normal
   * run-scoped subdomain (every other self-host scenario).
   */
  fixedSubdomain?: string;
  /** Reusable wildcard certificate capacity for *.qualification.proliferate.com. */
  tls: QualificationTlsInput;
  /** Injectable seams; all default to the real world (no real AWS/SSH/browser in unit tests). */
  deps?: SelfHostWorldDeps;
}

export interface SelfHostWorldDeps {
  ec2Exec?: Ec2Exec;
  route53Exec?: Route53Exec;
  /** Builds an `SshTransport` for a provisioned box (faked offline). */
  sshFactory?: (box: Ec2Box, keyPath: string) => SshTransport;
  /** Resolves this runner's public IP for the SSH `/32` ingress rule (faked offline). */
  publicIpResolver?: PublicIpResolver;
  /**
   * Resolves the four candidate artifacts from the map. Defaults to the real
   * `resolveSelfHostCandidateSet` (workstream B); injected in unit tests so the
   * world constructor is exercised offline while the resolver lands in parallel.
   */
  resolveCandidateSet?: (map: CandidateBuildMapV1) => SelfHostCandidateSet;
  spawn?: SpawnLike;
  chromiumLauncher?: ChromiumLauncher;
  extractExec?: Exec;
  readinessFetch?: ReadinessFetch;
  ledgerMirror?: CleanupLedgerMirror;
}

/**
 * Where the shipped `install.sh` installs the deploy dir on the box
 * (`$INSTALL_ROOT/server/deploy`, default `/opt/proliferate/server/deploy`).
 * Single-sourced from `install.ts` so the control handle (setup-token read,
 * restart, on-box digest assertion) targets the exact directory the installer
 * created — a `~/proliferate/deploy` guess does not exist on the box.
 */
const REMOTE_DEPLOY_DIR = SELFHOST_DEPLOY_DIR;
/**
 * The compose invocation the deploy scripts use, run over SSH. Both
 * `PROLIFERATE_ENV_FILE` and `--env-file` are needed because the production
 * compose file resolves each service's `env_file` from the interpolation
 * environment, not from `--env-file`.
 */
const COMPOSE_OVER_SSH =
  "sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime " +
  `-f docker-compose.production.yml -f ${SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE}`;
/** On-box path the api container writes the one-time first-run setup token to. */
const SETUP_TOKEN_PATH = "/var/lib/proliferate/setup/setup-token";

/**
 * Constructs the self-host world per the frozen "World construction" steps:
 * run-scoped dirs + ledger (new AWS resource kinds, registered-before-create) →
 * materialize + re-hash the four candidate artifacts → provision run-scoped EC2
 * (SG 80/443 world + 22 to the runner IP, unique key pair) + Route53 A record →
 * bounded readiness (SSH/SSM + cloud-init) → launch the controller-local
 * candidate AnyHarness (isolated home, scrubbed child env — no ambient provider
 * keys) → extract + serve the candidate renderer → launch Chromium → build the
 * control handle. It does NOT install or claim.
 *
 * On any startup failure, every registered cleanup runs exactly once in reverse
 * order, then the error rethrows so the caller marks the cell failed.
 */
export async function constructSelfHostWorld(
  options: ConstructSelfHostWorldOptions,
): Promise<ReadySelfHostWorld> {
  const deps = options.deps ?? {};
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs;

  // Resolve the four required artifacts BEFORE any side effect: an invalid map
  // provisions no EC2/DNS, launches no process, creates no ledger.
  const resolveSet = deps.resolveCandidateSet ?? resolveSelfHostCandidateSet;
  const candidateSet = resolveSet(options.map);
  decodeQualificationTls(options.tls);

  const runDir = options.runDir;
  const artifactsDir = path.join(runDir, "artifacts");
  const rendererDir = path.join(runDir, "renderer");
  const runtimeHome = path.join(runDir, "runtime-home");
  const keyDir = path.join(runDir, "ssh");
  const logsDir = path.join(runDir, "logs");
  const secretsDir = path.join(runDir, "secrets");
  for (const dir of [runDir, artifactsDir, rendererDir, runtimeHome, keyDir, logsDir]) {
    await mkdir(dir, { recursive: true });
  }
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const tls = await materializeQualificationTls(options.tls, secretsDir);

  const ledger = await openCleanupLedger({
    runDir,
    runId: options.run.run_id,
    shardId: options.run.shard_id,
    mirror: deps.ledgerMirror,
  });
  const stack = new SelfHostCleanupStack({ ledger, log });
  const cancellationFinalizer = registerCancellationFinalizer({
    world: "self-host",
    run: options.run,
    runDir,
    finalize: () => stack.runAll(),
  });

  const register = async (
    kind: SelfHostCleanupResourceKind,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void> => {
    const entryId = await stack.register(kind, release);
    await stack.acquired(entryId, providerId);
  };

  try {
    // Register durable-path + reservation releasers first so they tear down LAST
    // (reverse order), after every AWS resource and process that lives above.
    await register("run_directory", runDir, () => rm(runDir, { recursive: true, force: true }));
    await register(
      "port_registration",
      [options.ports.anyharness, options.ports.renderer].join(","),
      async () => undefined,
    );
    await register("runtime_home", runtimeHome, () => rm(runtimeHome, { recursive: true, force: true }));
    await register("extracted_artifacts", artifactsDir, async () => {
      await rm(artifactsDir, { recursive: true, force: true });
      await rm(rendererDir, { recursive: true, force: true });
    });

    // Materialize + re-hash the four mapped artifacts into run storage.
    const serverImage = await materialize(candidateSet.serverImage.artifact_id, options.map, artifactsDir);
    const bundle = await materialize(candidateSet.bundle.artifact_id, options.map, artifactsDir);
    const anyharnessArtifact = await materialize(candidateSet.anyharness.artifact_id, options.map, artifactsDir);
    const rendererArtifact = await materialize(candidateSet.desktopRenderer.artifact_id, options.map, artifactsDir);

    // Provision run-scoped EC2 + DNS. resolveRunnerPublicIp is read-only; the
    // provisioner registers key_pair → security_group → ec2_instance before each
    // create (reverse teardown: instance → SG → key pair), then Route53 registers
    // its DELETE releaser before the UPSERT.
    const runnerIp = await resolveRunnerPublicIp({ resolve: deps.publicIpResolver });
    const scopedName = runScopedName(options.run.run_id, options.run.shard_id);
    const box = await provisionEc2Box({
      inputs: {
        region: options.aws.region,
        instanceType: options.aws.instanceType,
        runnerCidr: `${runnerIp}/32`,
        keyName: scopedName,
        securityGroupName: scopedName,
        sshUser: options.ssh.sshUser,
        tags: { Name: scopedName, RunId: options.run.run_id, ShardId: options.run.shard_id },
        keyDir,
      },
      exec: deps.ec2Exec,
      log,
      timeoutMs,
      registerCleanup: register,
    });

    // A serial-lane scenario may pin a FIXED subdomain (see `fixedSubdomain`'s
    // doc) so the box's public origin matches a pre-registered OAuth callback;
    // every other scenario uses the collision-free run-scoped label.
    const subdomain = options.fixedSubdomain?.trim() || runSubdomainLabel(options.run.run_id, options.run.shard_id);
    const record = await upsertRoute53ARecord({
      hostedZoneId: options.aws.hostedZoneId,
      subdomain,
      ip: box.publicIp,
      zone: options.aws.zone,
      exec: deps.route53Exec,
      log,
      registerCleanup: register,
    });
    const apiOrigin = `https://${record.recordName}`;

    // Bounded readiness over SSH before any process/browser is launched.
    const ssh = (deps.sshFactory ?? defaultSshFactory)(box, box.keyPath);
    await waitForSshAndCloudInit({ ssh, timeoutMs, log });

    // Controller-local candidate AnyHarness (isolated home, hermetic env — no
    // ambient provider/gateway keys until a BYOK selection pushes one through
    // the product path). It runs on the CONTROLLER, not on the box.
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

    // Extract + statically serve the candidate renderer, then the shared browser.
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

    const browser = await launchChromium({ log, launcher: deps.chromiumLauncher });
    await register("browser", "chromium", () => browser.close());

    const control: SelfHostControlHandle = {
      box,
      ssh,
      readSetupToken: () => readSetupTokenOverControl(ssh),
      restartStack: () => restartStackOverControl(ssh),
      assertRunningImageDigest: (expected) => assertRunningImageDigestOverControl(ssh, expected),
    };

    log(`self-host world ready (run ${options.run.run_id}/${options.run.shard_id}, api ${apiOrigin})`);

    return {
      kind: "selfhost",
      run: options.run,
      artifacts: { serverImage, bundle, anyharness: anyharnessArtifact, desktopRenderer: rendererArtifact },
      api: { baseUrl: apiOrigin, client: new ApiClient({ baseUrl: apiOrigin }) },
      runtime: { baseUrl: anyharness.baseUrl, client: new LocalRuntimeClient({ baseUrl: anyharness.baseUrl }) },
      renderer: { baseUrl: served.baseUrl, browser },
      control,
      paths: {
        runDir,
        runtimeHome,
        artifactsDir,
        keyPath: box.keyPath,
        tlsCertificatePath: tls.certificatePath,
        tlsPrivateKeyPath: tls.privateKeyPath,
      },
      registerCleanup: (kind, providerId, release) => register(kind, providerId, release),
      close: () => cancellationFinalizer.run(),
    };
  } catch (error) {
    // Any startup failure runs every registered cleanup exactly once, reverse
    // order, then rethrows so the caller marks the cell failed.
    await cancellationFinalizer.run().catch(() => undefined);
    throw error;
  }
}

/**
 * A provisioned pair of independent self-host worlds (frozen tier-3 contract
 * `SH-SWITCH-ISOLATION`: "Cross-server isolation alone provisions two"). `a` is
 * the server whose public API origin equals the ONE origin the web candidate
 * renderer was built with (its baked `VITE_PROLIFERATE_API_BASE_URL`, derived
 * from the run/shard subdomain), so `a`'s renderer/browser are the shared
 * Desktop-renderer product state the isolation cell drives; `b` is a second,
 * fully distinct self-host instance (its own EC2 box, security group, key pair,
 * Route53 record, and controller-local ports) the product state is switched to.
 */
export interface SelfHostWorldPair {
  a: ReadySelfHostWorld;
  b: ReadySelfHostWorld;
}

/**
 * A fixed, well-separated offset applied to server B's controller-local ports.
 * Server A reuses the builder's pre-allocated `local-world-ports.json` (the
 * renderer/AnyHarness URLs baked into A's renderer bytes); server B needs a
 * SECOND, non-conflicting set of controller-local ports for its own renderer +
 * AnyHarness. The candidate builder allocates only ONE port set today, so the
 * pair constructor derives B's set from A's by this offset.
 *
 * TODO(builder-flag, other workstream): the honest end state is for
 * `scripts/ci-cd/build-selfhost-qualification-candidates.mjs` to allocate and
 * write a SECOND port set (e.g. a `--second-ports`/`local-world-ports-b.json`
 * sidecar), which the isolation scenario would thread in as
 * `ConstructSelfHostWorldPairOptions.bPorts`. Until that 1-flag builder change
 * lands, this deterministic offset stands in; a collision surfaces as a bounded
 * world-construction failure (fail-closed), never a silent green.
 */
export const SECOND_WORLD_PORT_OFFSET = 1000;

/**
 * Derives server B's controller-local ports from server A's by a fixed offset,
 * keeping every value a valid TCP port (1024–65535). B's renderer bytes are the
 * same baked-to-A candidate archive (B's renderer is never pointed at B — the
 * product cannot repoint a web renderer at runtime), so B's ports need not be
 * deterministic/baked; they only have to not conflict with A's live binds.
 */
export function offsetLocalWorldPorts(ports: LocalWorldPorts, offset = SECOND_WORLD_PORT_OFFSET): LocalWorldPorts {
  const bump = (port: number): number => {
    const shifted = port + offset;
    // Wrap back into the 1024–65535 range so an already-high port stays valid.
    return shifted <= 65_535 ? shifted : 1024 + ((shifted - 1024) % (65_535 - 1024));
  };
  return {
    server: bump(ports.server),
    postgres: bump(ports.postgres),
    redis: bump(ports.redis),
    anyharness: bump(ports.anyharness),
    renderer: bump(ports.renderer),
  };
}

export interface ConstructSelfHostWorldPairOptions extends ConstructSelfHostWorldOptions {
  /**
   * Server B's controller-local ports. Defaults to A's ports offset by
   * {@link SECOND_WORLD_PORT_OFFSET} (see the TODO there for the builder change
   * that would supply a real second allocation instead).
   */
  bPorts?: LocalWorldPorts;
  /**
   * The shard-id suffix that makes server B's run-scoped names + subdomain
   * distinct from A's. Every run-scoped identity (`runScopedName` /
   * `runSubdomainLabel`) is derived from the `<runId>:<shardId>` pair, so
   * suffixing B's shard id yields a fully distinct EC2 box, security group, key
   * pair, DNS record, ledger, and run directory — without touching the existing
   * single-world constructor's signature. Default `"b"`.
   */
  bShardSuffix?: string;
}

/**
 * Constructs the two independent self-host worlds `SH-SWITCH-ISOLATION` needs.
 * Server A is built with the run identity UNCHANGED so its public API origin
 * equals the renderer's baked origin (the only origin a web renderer can
 * reach); server B is built with a shard-suffixed identity (distinct EC2/DNS/SG/
 * key-pair/ledger) and its own controller-local ports. Each world owns its own
 * cleanup ledger and tears down independently via `close()`; the isolation cell
 * folds the two cleanup summaries into one evidence block.
 *
 * If B fails to construct, A is closed before rethrowing so a partial pair never
 * leaks a provisioned box.
 */
export async function constructSelfHostWorldPair(
  options: ConstructSelfHostWorldPairOptions,
): Promise<SelfHostWorldPair> {
  const bShardSuffix = options.bShardSuffix ?? "b";
  const bPorts = options.bPorts ?? offsetLocalWorldPorts(options.ports);

  const a = await constructSelfHostWorld({
    ...options,
    runDir: path.join(options.runDir, "server-a"),
  });
  try {
    const b = await constructSelfHostWorld({
      ...options,
      run: { ...options.run, shard_id: `${options.run.shard_id}-${bShardSuffix}` },
      runDir: path.join(options.runDir, `server-${bShardSuffix}`),
      ports: bPorts,
    });
    return { a, b };
  } catch (error) {
    await a.close().catch(() => undefined);
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

/** Reads the one-time first-run setup token from the api container over SSH. */
async function readSetupTokenOverControl(ssh: SshTransport): Promise<string> {
  const out = (
    await ssh.run(
      `cd ${REMOTE_DEPLOY_DIR} && ${COMPOSE_OVER_SSH} exec -T api cat ${SETUP_TOKEN_PATH} 2>/dev/null || true`,
      { timeoutMs: 60_000 },
    )
  ).trim();
  if (!out) {
    throw new Error("first-run setup token is empty (already claimed or not yet minted).");
  }
  return out;
}

/** Restarts the compose stack on the box (persistence assertion support). */
async function restartStackOverControl(ssh: SshTransport): Promise<void> {
  await ssh.run(`cd ${REMOTE_DEPLOY_DIR} && ${COMPOSE_OVER_SSH} restart`, { timeoutMs: 5 * 60_000 });
}

/**
 * Asserts the running api container's image id on the box equals the expected
 * candidate receipt (`sha256:...`). Returns the observed id; throws on mismatch
 * (the install cell treats a mismatch as a hard fail before claim).
 */
async function assertRunningImageDigestOverControl(ssh: SshTransport, expected: string): Promise<string> {
  const imageRef = (await ssh.run(`cd ${REMOTE_DEPLOY_DIR} && ${COMPOSE_OVER_SSH} images -q api`, { timeoutMs: 60_000 }))
    .trim()
    .split(/\s+/)[0];
  if (!imageRef) {
    throw new Error("could not resolve the running api image reference on the box.");
  }
  const observed = (await ssh.run(`sudo docker inspect --format '{{.Id}}' ${imageRef}`, { timeoutMs: 60_000 })).trim();
  if (!observed || observed !== expected) {
    throw new Error(`running image id "${observed || "<unknown>"}" does not match the candidate receipt "${expected}".`);
  }
  return observed;
}

function verifyVersion(component: string, reported: string, expected: string): void {
  if (reported !== expected) {
    throw new Error(
      `${component} reported version "${reported}" does not match the candidate map version "${expected}".`,
    );
  }
}

/**
 * A collision-free, DNS/EC2-safe run-scoped resource name (key pair + SG). A
 * short digest of the exact run/shard pair guarantees uniqueness even if the
 * sanitized prefix of two runs coincides.
 */
function runScopedName(runId: string, shardId: string): string {
  const digest = createHash("sha256").update(`${runId}:${shardId}`).digest("hex").slice(0, 8);
  const base = `selfhost-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");
  return `${base}-${digest}`;
}

const execFileAsync = promisify(execFile);

/** Real ssh/scp transport (never used in unit tests; secrets stay on the 0600 key file). */
function defaultSshFactory(box: Ec2Box, keyPath: string): SshTransport {
  const target = `${box.sshUser}@${box.publicIp}`;
  const sshOpts = [
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=15",
    // Keepalive so a long *silent* remote command (e.g. the gateway bootstrap,
    // which redirects all output to a file and blocks on `up -d --wait`) does
    // not get its idle TCP connection dropped by NAT — a dropped connection
    // SIGHUPs the foreground remote process and kills it mid-bootstrap
    // (observed as `client_loop: send disconnect: Broken pipe`).
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=8",
  ];
  return {
    async run(command, runOptions) {
      try {
        const { stdout } = await execFileAsync("ssh", [...sshOpts, target, command], {
          timeout: runOptions?.timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
        });
        return stdout.toString();
      } catch (error) {
        // execFile's message is just "Command failed: <cmd>\n<stderr>" — it
        // does not say WHY (nonzero exit vs local-timeout SIGTERM vs signal).
        // Stamp that identity on the message so evidence can distinguish a
        // remote failure from the harness killing its own ssh (observed:
        // three separate multi-hour diagnoses all started from a bare
        // "Command failed: ssh ...").
        if (error instanceof Error) {
          const meta = error as Error & { code?: unknown; signal?: unknown; killed?: boolean };
          const kind = meta.killed
            ? `harness killed ssh (timeoutMs=${runOptions?.timeoutMs ?? "none"}, signal=${String(meta.signal)})`
            : `exit=${String(meta.code ?? "unknown")}${meta.signal ? `, signal=${String(meta.signal)}` : ""}`;
          error.message = `[ssh ${kind}] ${error.message}`;
        }
        throw error;
      }
    },
    async scp(localPath, remotePath) {
      await execFileAsync("scp", [...sshOpts, localPath, `${target}:${remotePath}`], {
        maxBuffer: 32 * 1024 * 1024,
      });
    },
  };
}
