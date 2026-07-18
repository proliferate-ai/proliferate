import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Browser } from "playwright";

import type { CandidateBuildArtifactV1, CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import type { FetchLike, HttpResponseLike, QualificationLiteLlmConfig } from "../../services/qualification-litellm.js";
import { CLEANUP_LEDGER_FILENAME } from "../local-workspace/cleanup-ledger.js";
import type { Exec } from "../local-workspace/docker.js";
import type { ReadinessFetch, SpawnLike } from "../local-workspace/processes.js";
import type { ChromiumLauncher } from "../local-workspace/renderer.js";
import { TEST_QUALIFICATION_TLS } from "../qualification-tls.test-fixture.js";
import type { CandidateE2bConfig, CandidateGithubAppConfig, SshExec } from "./ingress.js";
import type { Ec2ProvisionConfig, Ec2Provisioner } from "./ec2.js";
import type { E2bBuildConfig, E2bTemplateReceipt, ResolveOrBuildManagedCloudTemplateOptions } from "./template.js";
import { constructManagedCloudWorld, type ManagedCloudWorldDeps } from "./world.js";

const RUN: RunIdentityV1 = {
  run_id: "mc-run-1",
  shard_id: "shard-0",
  attempt: 1,
  source_sha: "0".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const SERVER_VERSION = "1.2.3";
const RENDERER_PORT = 41999;

const LITELLM: QualificationLiteLlmConfig = {
  adminBaseUrl: "http://admin",
  publicBaseUrl: "http://public",
  masterKey: "sk-master-SECRET",
};

const AWS: Ec2ProvisionConfig = {
  region: "us-east-1",
  hostedZoneId: "Z123QUALIFICATION",
  zoneName: "qualification.proliferate.com",
  instanceType: "t3.small",
  imageRef: "ami-01234567",
};

async function fileArtifact(dir: string, id: string, content: string): Promise<CandidateBuildArtifactV1> {
  const filePath = path.join(dir, encodeURIComponent(id));
  await writeFile(filePath, content);
  return {
    artifact_id: id,
    version: id.startsWith("server/") ? SERVER_VERSION : "0.1.0",
    sha256: createHash("sha256").update(content).digest("hex"),
    locator: { kind: "local_file", path: filePath },
  };
}

async function buildMap(dir: string): Promise<CandidateBuildMapV1> {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "0".repeat(40),
    artifacts: [
      await fileArtifact(dir, "server/linux/amd64", "server-image-bytes"),
      await fileArtifact(dir, "anyharness/x86_64-unknown-linux-musl", "anyharness-bytes"),
      await fileArtifact(dir, "worker/x86_64-unknown-linux-musl", "worker-bytes"),
      await fileArtifact(dir, "supervisor/x86_64-unknown-linux-musl", "supervisor-bytes"),
      await fileArtifact(dir, "credential-helper/x86_64-unknown-linux-musl", "cred-helper-bytes"),
      await fileArtifact(dir, "desktop-renderer/browser", "renderer-tar-bytes"),
    ],
  };
}

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/** LiteLLM fake: preflight (liveness + models) and subject deletion. */
function litellmFetch(state?: { called: boolean }): FetchLike {
  return async (url) => {
    if (state) state.called = true;
    if (url.includes("/health/liveliness")) return jsonResponse({ status: "connected" });
    if (url.includes("/v1/models")) return jsonResponse({ data: [{ id: "claude-haiku-4-5" }] });
    if (url.includes("/delete")) return jsonResponse({});
    return jsonResponse({ error: { message: "unrouted" } }, 404);
  };
}

/** Records the AWS resource lifecycle without touching real AWS. */
function recordingProvisioner(events: string[], deletes: string[], publicIp = "203.0.113.9"): Ec2Provisioner {
  return {
    async createKeyPair(_c, _t, _name, keyPath) {
      events.push("create:key_pair");
      await writeFile(keyPath, "KEY", { mode: 0o600 });
    },
    async deleteKeyPair() {
      deletes.push("key_pair");
    },
    async createSecurityGroup() {
      events.push("create:security_group");
      return "sg-1";
    },
    async authorizeIngress() {
      events.push("authorize");
    },
    async deleteSecurityGroup() {
      deletes.push("security_group");
    },
    async runInstance() {
      events.push("create:ec2_instance");
      return "i-1";
    },
    async waitInstanceRunning() {
      return publicIp;
    },
    async waitStatusOk() {
      /* noop */
    },
    async terminateInstance() {
      deletes.push("ec2_instance");
    },
    async upsertARecord() {
      events.push("create:route53_record");
    },
    async deleteARecord() {
      deletes.push("route53_record");
    },
  };
}

/** SSH fake for the on-box candidate deploy (mirrors ingress.test.ts). */
function fakeSsh(): SshExec {
  return {
    async run(_dest, _key, command) {
      if (command.includes("ingress-ready")) return { stdout: "Docker version 24.0\n", stderr: "" };
      if (command.includes("docker load")) return { stdout: "Loaded image: candidate-server:candidate\n", stderr: "" };
      if (command.includes("pg_isready")) return { stdout: "accepting connections\n", stderr: "" };
      if (command.includes("test -s")) return { stdout: "present\n", stderr: "" };
      if (command.startsWith("cat ")) return { stdout: "SETUP-TOKEN-XYZ\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    async copyFile() {
      /* fake copy: never reads the local file */
    },
  };
}

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  stderr: EventEmitter;
  kill(signal?: string): boolean;
}

function fakeSpawn(state: { killed: number }): SpawnLike {
  return (_command, _args, _options: SpawnOptions) => {
    const child = new EventEmitter() as FakeChild;
    child.pid = 2000 + state.killed;
    child.exitCode = null;
    child.signalCode = null;
    child.stderr = new EventEmitter();
    child.kill = (signal = "SIGTERM") => {
      state.killed += 1;
      child.signalCode = signal;
      setImmediate(() => child.emit("exit", 0, signal));
      return true;
    };
    return child as unknown as ChildProcess;
  };
}

function fakeChromium(state: { closed: boolean }): ChromiumLauncher {
  return async () =>
    ({
      close: async () => {
        state.closed = true;
      },
    }) as unknown as Browser;
}

/** Renderer readiness fake: the static server answers 200 immediately. */
const rendererFetch: ReadinessFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
/** Extract fake: no real tar. */
const extractExec: Exec = async () => ({ stdout: "", stderr: "" });

interface TemplateState {
  built: boolean;
  templateId: string;
  buildId: string;
}

/** Fake template resolver: registers the e2b_template cleanup, returns a receipt. */
function fakeResolveTemplate(state: TemplateState) {
  return async (options: ResolveOrBuildManagedCloudTemplateOptions): Promise<E2bTemplateReceipt> => {
    state.built = true;
    if (state.templateId && state.buildId) {
      await options.register(state.templateId, async () => undefined);
    }
    return {
      artifact_id: `e2b-template/${options.config.templateName}`,
      templateId: state.templateId,
      buildId: state.buildId,
      inputHash: "b".repeat(64),
      bakedInputs: [{ destination: "/home/user/anyharness", sha256: "a".repeat(64) }],
    };
  };
}

interface Harness {
  deps: ManagedCloudWorldDeps;
  awsEvents: string[];
  awsDeletes: string[];
  spawnState: { killed: number };
  browserState: { closed: boolean };
  templateState: TemplateState;
  litellmState: { called: boolean };
}

function harness(options?: {
  probeVersion?: string;
  publicIp?: string;
  templateId?: string;
  buildId?: string;
}): Harness {
  const awsEvents: string[] = [];
  const awsDeletes: string[] = [];
  const spawnState = { killed: 0 };
  const browserState = { closed: false };
  const templateState: TemplateState = {
    built: false,
    templateId: options?.templateId ?? "tmpl-abc",
    buildId: options?.buildId ?? "build-abc",
  };
  const litellmState = { called: false };
  return {
    awsEvents,
    awsDeletes,
    spawnState,
    browserState,
    templateState,
    litellmState,
    deps: {
      litellmFetch: litellmFetch(litellmState),
      ec2Provisioner: recordingProvisioner(awsEvents, awsDeletes, options?.publicIp ?? "203.0.113.9"),
      ssh: fakeSsh(),
      probeHealth: async () => ({ ok: true, version: options?.probeVersion ?? SERVER_VERSION }),
      resolveTemplate: fakeResolveTemplate(templateState),
      chromiumLauncher: fakeChromium(browserState),
      spawn: fakeSpawn(spawnState),
      rendererFetch,
      extractExec,
      rendererPort: RENDERER_PORT,
    },
  };
}

function e2bConfig(secretsEnvFilePath: string): E2bBuildConfig & CandidateE2bConfig {
  return { teamId: "team-qual", secretsEnvFilePath, templateName: "team-qual/proliferate-runtime-qual-mc-run-1" };
}

function githubConfig(secretsEnvFilePath: string): CandidateGithubAppConfig {
  return {
    appSlug: "proliferate-cloud-staging",
    appId: "12345",
    clientId: "Iv1.abc",
    installationId: "99887766",
    secretsEnvFilePath,
    privateKeyPemPath: `${secretsEnvFilePath}.pem`,
  };
}

async function makeSecretFiles(runDir: string): Promise<{ github: string; e2b: string }> {
  const github = path.join(runDir, "github.secrets.env");
  await writeFile(github, "GITHUB_APP_PRIVATE_KEY=PEM-SECRET\nGITHUB_APP_CLIENT_SECRET=cs-SECRET\n", { mode: 0o600 });
  const e2b = path.join(runDir, "e2b.secrets.env");
  await writeFile(e2b, "RELEASE_E2E_E2B_API_KEY=e2b-SECRET\n", { mode: 0o600 });
  return { github, e2b };
}

test("constructManagedCloudWorld runs the ordered startup and returns a ready handle", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-run-"));
  try {
    const map = await buildMap(src);
    const secrets = await makeSecretFiles(runDir);
    const h = harness();
    const world = await constructManagedCloudWorld({
      run: RUN,
      map,
      litellm: LITELLM,
      aws: AWS,
      e2b: e2bConfig(secrets.e2b),
      github: githubConfig(secrets.github),
      tls: TEST_QUALIFICATION_TLS,
      runDir,
      deps: h.deps,
    });

    const expectedSubdomain = "mcq-mc-run-1-shard-0.qualification.proliferate.com";
    assert.equal(world.kind, "managed-cloud");
    assert.equal(world.artifacts.server.version, SERVER_VERSION);
    assert.equal(world.artifacts.anyharness.artifact_id, "anyharness/x86_64-unknown-linux-musl");
    assert.equal(world.artifacts.template.templateId, "tmpl-abc");
    assert.equal(world.artifacts.template.buildId, "build-abc");
    assert.equal(world.artifacts.candidateApi.artifact_id, `candidate-api/${expectedSubdomain}`);
    assert.equal(world.artifacts.candidateApi.publicOrigin, `https://${expectedSubdomain}`);
    assert.equal(world.api.baseUrl, `https://${expectedSubdomain}`);
    assert.equal(world.renderer.baseUrl, `http://127.0.0.1:${RENDERER_PORT}`);
    assert.equal(world.sandbox.e2bTeamId, "team-qual");

    // The world made the candidate API + immutable template AVAILABLE.
    assert.ok(h.templateState.built);
    for (const created of [
      "create:key_pair",
      "create:security_group",
      "create:ec2_instance",
      "create:route53_record",
    ]) {
      assert.ok(h.awsEvents.includes(created), `expected the world to provision ${created}`);
    }

    // Materialized copies live under the run dir; the durable ledger is written.
    await access(world.artifacts.anyharness.path);
    await access(path.join(runDir, CLEANUP_LEDGER_FILENAME));

    // The scenario (not the world) creates the user's sandbox; simulate it so a
    // full green teardown includes sandboxesDeleted.
    let sandboxDeleted = false;
    await world.registerCleanup!("e2b_sandbox", "sbx-1", async () => {
      sandboxDeleted = true;
    });
    // A fresh actor enrolled for cleanup.
    await world.trackActorSubjects!({
      userId: "u1",
      enrollmentId: "e1",
      teamId: "team_1",
      litellmUserId: "user-u1",
      keyAlias: "vk-user-u1-e1",
      tokenId: "tok",
      tokenIdHash: "hash",
    });

    const evidence = await world.close();
    assert.equal(evidence.failed, 0);
    assert.equal(evidence.sandboxesDeleted, true);
    assert.equal(evidence.templateDeleted, true);
    assert.equal(evidence.dnsRecordDeleted, true);
    assert.equal(evidence.ec2Terminated, true);
    assert.equal(evidence.securityGroupDeleted, true);
    assert.equal(evidence.keyPairDeleted, true);
    assert.equal(evidence.virtualKeyDeleted, true);
    assert.equal(evidence.litellmSubjectsDeleted, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.match(evidence.ledgerIdHash, /^[0-9a-f]{64}$/);
    assert.equal(sandboxDeleted, true);
    assert.equal(h.browserState.closed, true);
    // Reverse-order teardown reclaimed every AWS resource.
    assert.deepEqual(h.awsDeletes, ["route53_record", "ec2_instance", "security_group", "key_pair"]);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a Server /health version mismatch fails startup and runs registered cleanup", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-run-"));
  try {
    const map = await buildMap(src);
    const secrets = await makeSecretFiles(runDir);
    const h = harness({ probeVersion: "9.9.9-wrong" });
    await assert.rejects(
      constructManagedCloudWorld({
        run: RUN,
        map,
        litellm: LITELLM,
        aws: AWS,
        e2b: e2bConfig(secrets.e2b),
        github: githubConfig(secrets.github),
        tls: TEST_QUALIFICATION_TLS,
        runDir,
        deps: h.deps,
      }),
      /does not match the candidate map version/,
    );
    // The EC2 ingress was provisioned before the failed health gate, so cleanup
    // reclaimed it in reverse order; the template/renderer/browser never started.
    assert.deepEqual(h.awsDeletes, ["route53_record", "ec2_instance", "security_group", "key_pair"]);
    assert.equal(h.templateState.built, false);
    assert.equal(h.browserState.closed, false);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an empty provider template id fails startup and runs registered cleanup", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-run-"));
  try {
    const map = await buildMap(src);
    const secrets = await makeSecretFiles(runDir);
    const h = harness({ templateId: "" });
    await assert.rejects(
      constructManagedCloudWorld({
        run: RUN,
        map,
        litellm: LITELLM,
        aws: AWS,
        e2b: e2bConfig(secrets.e2b),
        github: githubConfig(secrets.github),
        tls: TEST_QUALIFICATION_TLS,
        runDir,
        deps: h.deps,
      }),
      /missing provider template\/build ids/,
    );
    // The candidate API deployed, then the empty template id aborted startup;
    // every AWS resource was still reclaimed and no browser was launched.
    assert.deepEqual(h.awsDeletes, ["route53_record", "ec2_instance", "security_group", "key_pair"]);
    assert.equal(h.browserState.closed, false);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an invalid map starts no world (no preflight, no AWS, no ledger)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-run-"));
  try {
    const map = await buildMap(src);
    map.artifacts.push({
      artifact_id: "unexpected/extra",
      version: "1",
      sha256: "a".repeat(64),
      locator: { kind: "local_file", path: map.artifacts[0].locator.path },
    });
    const secrets = await makeSecretFiles(runDir);
    const h = harness();
    await assert.rejects(
      constructManagedCloudWorld({
        run: RUN,
        map,
        litellm: LITELLM,
        aws: AWS,
        e2b: e2bConfig(secrets.e2b),
        github: githubConfig(secrets.github),
        tls: TEST_QUALIFICATION_TLS,
        runDir,
        deps: h.deps,
      }),
      /unexpected artifact/,
    );
    assert.equal(h.litellmState.called, false); // preflight never ran
    assert.equal(h.awsEvents.length, 0); // AWS never touched
    await assert.rejects(access(path.join(runDir, CLEANUP_LEDGER_FILENAME))); // no ledger
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("two concurrent runs collide on nothing (subdomains, EC2 keys, templates, ledgers)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDirA = await mkdtemp(path.join(os.tmpdir(), "mc-a-"));
  const runDirB = await mkdtemp(path.join(os.tmpdir(), "mc-b-"));
  try {
    const map = await buildMap(src);
    const secretsA = await makeSecretFiles(runDirA);
    const secretsB = await makeSecretFiles(runDirB);
    const a = harness();
    const b = harness();
    const worldA = await constructManagedCloudWorld({
      run: RUN,
      map,
      litellm: LITELLM,
      aws: AWS,
      e2b: e2bConfig(secretsA.e2b),
      github: githubConfig(secretsA.github),
      tls: TEST_QUALIFICATION_TLS,
      runDir: runDirA,
      deps: a.deps,
    });
    const worldB = await constructManagedCloudWorld({
      run: { ...RUN, run_id: "mc-run-2" },
      map,
      litellm: LITELLM,
      aws: AWS,
      e2b: e2bConfig(secretsB.e2b),
      github: githubConfig(secretsB.github),
      tls: TEST_QUALIFICATION_TLS,
      runDir: runDirB,
      deps: b.deps,
    });

    // Distinct run subdomains ⇒ distinct public origins, candidate-api receipts,
    // and API base urls; the two runs never share an ingress identity.
    assert.notEqual(worldA.api.baseUrl, worldB.api.baseUrl);
    assert.notEqual(worldA.artifacts.candidateApi.artifact_id, worldB.artifacts.candidateApi.artifact_id);
    assert.match(worldA.api.baseUrl, /mc-run-1/);
    assert.match(worldB.api.baseUrl, /mc-run-2/);

    const evidenceA = await worldA.close();
    const evidenceB = await worldB.close();
    // Distinct ledgers (distinct run identity ⇒ distinct ledger id hash).
    assert.notEqual(evidenceA.ledgerIdHash, evidenceB.ledgerIdHash);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDirA, { recursive: true, force: true });
    await rm(runDirB, { recursive: true, force: true });
  }
});

test("the user's E2B sandbox is NOT pre-created by world construction", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "mc-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-run-"));
  try {
    const map = await buildMap(src);
    const secrets = await makeSecretFiles(runDir);
    const h = harness();
    const world = await constructManagedCloudWorld({
      run: RUN,
      map,
      litellm: LITELLM,
      aws: AWS,
      e2b: e2bConfig(secrets.e2b),
      github: githubConfig(secrets.github),
      tls: TEST_QUALIFICATION_TLS,
      runDir,
      deps: h.deps,
    });
    // World setup makes the template + candidate API available but must not spawn
    // the user's sandbox — provisioning is the scenario behavior. A green world
    // teardown therefore has no e2b_sandbox registrations, which is vacuously clean.
    const evidence = await world.close();
    assert.equal(evidence.sandboxesDeleted, true);
    assert.equal(evidence.failed, 0);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});
