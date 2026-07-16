import { mkdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { Browser } from "playwright";

import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import { resolveCloudCandidateSet } from "../../artifacts/cloud-candidate-set.js";
import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import { materializeLocalArtifact } from "../../artifacts/materialize-local.js";
import { ApiClient } from "../../fixtures/http.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import {
  QualificationLiteLlmController,
  type ActorKeyIdentity,
  type ActorSubjectsDeletion,
  type FetchLike,
  type QualificationLiteLlmConfig,
} from "../../services/qualification-litellm.js";
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
  AwsCliEc2Provisioner,
  provisionRunIngress,
  type Ec2ProvisionConfig,
  type Ec2Provisioner,
  type Ec2ResourceTags,
} from "./ec2.js";
import { createBoxExec, type BoxExec } from "./box-exec.js";
import {
  deployCandidateApi,
  defaultSshExec,
  type CandidateApiReceipt,
  type CandidateE2bConfig,
  type CandidateGithubAppConfig,
  type SshExec,
} from "./ingress.js";
import {
  E2bTemplateBuilder,
  resolveOrBuildManagedCloudTemplate,
  type E2bBuildConfig,
  type E2bTemplateReceipt,
  type ManagedCloudTemplateBuilder,
  type ManagedCloudTemplateInputs,
  type ResolveOrBuildManagedCloudTemplateOptions,
} from "./template.js";

/** Host filename the first-run setup token is copied down to under the run directory. */
const SETUP_TOKEN_FILENAME = "setup-token";
/** Agent CLI kinds baked into the template + probed live (this world is claude-only). */
const DEFAULT_AGENT_KINDS = ["claude"];

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
   * Enrols the actor's LiteLLM virtual key + user + team for deletion during
   * `close()`, ordered before local teardown so the deterministic alias stays
   * recoverable (reused PR 1 semantics). The actor identity only exists after
   * enrolment, so it cannot be known at construction.
   */
  trackActorSubjects?(actor: ActorKeyIdentity): Promise<void>;

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
  /** Run/shard-scoped root; all world state lives under here. */
  runDir: string;
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

  const gateway = new QualificationLiteLlmController(options.litellm, { fetch: deps.litellmFetch });
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
      publicOrigin,
      rendererOrigin,
      secretsDir,
      setupTokenHostPath: path.join(runDir, SETUP_TOKEN_FILENAME),
      ssh,
      probeHealth: deps.probeHealth ?? pinnedHttpsHealthProbe(record.address),
      timeoutMs,
      log,
    });

    // Build/publish the immutable E2B template (registered-before-create by the
    // orchestration) baking the four musl binaries under `/home/user/...`.
    const templateInputs: ManagedCloudTemplateInputs = {
      anyharness: anyharnessArtifact,
      worker: workerArtifact,
      supervisor: supervisorArtifact,
      credentialHelper: credentialHelperArtifact,
      bootstrapInputs: [],
      agentKinds: options.agentKinds ?? DEFAULT_AGENT_KINDS,
    };
    const resolveTemplate = deps.resolveTemplate ?? resolveOrBuildManagedCloudTemplate;
    const template = await resolveTemplate({
      inputs: templateInputs,
      config: options.e2b,
      builder: deps.templateBuilder ?? new E2bTemplateBuilder(),
      register: (providerId, release) => register("e2b_template", providerId, release),
      cacheDir,
      log,
    });
    if (!template.templateId || !template.buildId) {
      throw new Error("managed-cloud template receipt is missing provider template/build ids.");
    }

    // Serve the Desktop renderer (built with the public API origin baked in)
    // against a local port + launch the shared Chromium browser.
    const extracted = await extractRenderer(rendererArtifact, rendererDir, { exec: deps.extractExec });
    const served = await serveRenderer({
      extracted,
      host: "127.0.0.1",
      port: rendererPort,
      timeoutMs,
      log,
      spawn: deps.spawn,
      fetch: deps.rendererFetch,
    });
    await register("renderer_process", `pid:${served.process.child.pid ?? "unknown"}`, () =>
      served.process.terminate(),
    );

    // Pin the run subdomain to the box IP inside Chromium too — the laptop
    // resolver's observed NXDOMAIN flaps would otherwise break the renderer's
    // API calls mid-scenario. TLS/SNI still validate the real LE certificate.
    const browser = await launchChromium({
      log,
      launcher: deps.chromiumLauncher,
      args: [`--host-resolver-rules=MAP ${subdomain} ${record.address}`],
    });
    await register("browser", "chromium", () => browser.close());

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
      box: createBoxExec({
        ssh,
        destination: box.sshDestination,
        keyPath: box.keyPath,
        secretsDir,
        log,
      }),
      paths: { runDir, secretsDir },
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
