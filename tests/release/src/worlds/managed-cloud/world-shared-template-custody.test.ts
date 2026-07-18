import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Browser } from "playwright";

import type { CandidateBuildArtifactV1, CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import type {
  FetchLike,
  HttpResponseLike,
  QualificationLiteLlmConfig,
} from "../../services/qualification-litellm.js";
import type { Exec } from "../local-workspace/docker.js";
import type { ReadinessFetch, SpawnLike } from "../local-workspace/processes.js";
import type { ChromiumLauncher } from "../local-workspace/renderer.js";
import { TEST_QUALIFICATION_TLS } from "../qualification-tls.test-fixture.js";
import type { Ec2ProvisionConfig, Ec2Provisioner } from "./ec2.js";
import type { CandidateE2bConfig, CandidateGithubAppConfig, SshExec } from "./ingress.js";
import {
  loadSharedTemplateCustody,
  sharedTemplateCustodyPath,
} from "./shared-template-custody.js";
import {
  computeManagedCloudTemplateHash,
  type E2bBuildConfig,
  type E2bTemplateReceipt,
  type ResolveOrBuildManagedCloudTemplateOptions,
} from "./template.js";
import { constructManagedCloudWorld, type ManagedCloudWorldDeps } from "./world.js";

const RUN: RunIdentityV1 = {
  run_id: "shared-template-run",
  shard_id: "1",
  attempt: 1,
  source_sha: "a".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const SERVER_VERSION = "1.2.3";
const TEMPLATE_NAME = `proliferate-runtime-qual-${RUN.run_id}`;
const LITELLM: QualificationLiteLlmConfig = {
  adminBaseUrl: "http://litellm-admin.invalid",
  publicBaseUrl: "http://litellm-public.invalid",
  masterKey: "sk-test-offline",
};
const AWS: Ec2ProvisionConfig = {
  region: "us-east-1",
  hostedZoneId: "Z-QUALIFICATION",
  zoneName: "qualification.proliferate.com",
  instanceType: "t3.small",
  imageRef: "ami-offline",
};

async function candidateArtifact(
  dir: string,
  artifactId: string,
  content: string,
): Promise<CandidateBuildArtifactV1> {
  const artifactPath = path.join(dir, encodeURIComponent(artifactId));
  await writeFile(artifactPath, content);
  return {
    artifact_id: artifactId,
    version: artifactId.startsWith("server/") ? SERVER_VERSION : "0.1.0",
    sha256: createHash("sha256").update(content).digest("hex"),
    locator: { kind: "local_file", path: artifactPath },
  };
}

async function candidateMap(dir: string): Promise<CandidateBuildMapV1> {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: RUN.source_sha,
    artifacts: await Promise.all([
      candidateArtifact(dir, "server/linux/amd64", "server"),
      candidateArtifact(dir, "anyharness/x86_64-unknown-linux-musl", "anyharness"),
      candidateArtifact(dir, "worker/x86_64-unknown-linux-musl", "worker"),
      candidateArtifact(dir, "supervisor/x86_64-unknown-linux-musl", "supervisor"),
      candidateArtifact(dir, "credential-helper/x86_64-unknown-linux-musl", "credential-helper"),
      candidateArtifact(dir, "desktop-renderer/browser", "renderer"),
    ]),
  };
}

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const litellmFetch: FetchLike = async (url) => {
  if (url.includes("/health/liveliness")) return jsonResponse({ status: "connected" });
  if (url.includes("/v1/models")) return jsonResponse({ data: [{ id: "claude-haiku-4-5" }] });
  if (url.includes("/delete")) return jsonResponse({});
  return jsonResponse({ error: { message: "unrouted offline request" } }, 404);
};

function provisioner(): Ec2Provisioner {
  return {
    async createKeyPair(_config, _tags, _name, keyPath) {
      await writeFile(keyPath, "OFFLINE KEY", { mode: 0o600 });
    },
    async deleteKeyPair() {},
    async createSecurityGroup() {
      return "sg-offline";
    },
    async authorizeIngress() {},
    async deleteSecurityGroup() {},
    async runInstance() {
      return "i-offline";
    },
    async waitInstanceRunning() {
      return "203.0.113.10";
    },
    async waitStatusOk() {},
    async terminateInstance() {},
    async upsertARecord() {},
    async deleteARecord() {},
  };
}

const ssh: SshExec = {
  async run(_destination, _keyPath, command) {
    if (command.includes("ingress-ready")) return { stdout: "Docker version 24\n", stderr: "" };
    if (command.includes("docker load")) return { stdout: "Loaded image: candidate-server:candidate\n", stderr: "" };
    if (command.includes("pg_isready")) return { stdout: "accepting connections\n", stderr: "" };
    if (command.includes("test -s")) return { stdout: "present\n", stderr: "" };
    if (command.startsWith("cat ")) return { stdout: "SETUP-TOKEN\n", stderr: "" };
    return { stdout: "", stderr: "" };
  },
  async copyFile() {},
};

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  stderr: EventEmitter;
  kill(signal?: string): boolean;
}

const spawn: SpawnLike = (_command, _args, _options: SpawnOptions) => {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new EventEmitter();
  child.kill = (signal = "SIGTERM") => {
    child.signalCode = signal;
    setImmediate(() => child.emit("exit", 0, signal));
    return true;
  };
  return child as unknown as ChildProcess;
};

const chromiumLauncher: ChromiumLauncher = async () =>
  ({ close: async () => undefined }) as unknown as Browser;
const rendererFetch: ReadinessFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
});
const extractExec: Exec = async () => ({ stdout: "", stderr: "" });

async function secrets(runDir: string): Promise<{ e2b: string; github: string }> {
  await mkdir(runDir, { recursive: true });
  const e2b = path.join(runDir, "e2b.env");
  const github = path.join(runDir, "github.env");
  await writeFile(e2b, "E2B_API_KEY=e2b-test-offline\n", { mode: 0o600 });
  await writeFile(github, "GITHUB_APP_CLIENT_SECRET=github-test-offline\n", { mode: 0o600 });
  return { e2b, github };
}

function e2bConfig(secretsEnvFilePath: string): E2bBuildConfig & CandidateE2bConfig {
  return { teamId: "team-offline", templateName: TEMPLATE_NAME, secretsEnvFilePath };
}

function githubConfig(secretsEnvFilePath: string): CandidateGithubAppConfig {
  return {
    appSlug: "qualification-offline",
    appId: "123",
    clientId: "Iv1.offline",
    installationId: "456",
    secretsEnvFilePath,
    privateKeyPemPath: `${secretsEnvFilePath}.pem`,
  };
}

interface PairHarness {
  buildCount: number;
  receipt: E2bTemplateReceipt | null;
  resolveTemplate: NonNullable<ManagedCloudWorldDeps["resolveTemplate"]>;
}

function pairHarness(): PairHarness {
  const state: PairHarness = {
    buildCount: 0,
    receipt: null,
    async resolveTemplate(
      options: ResolveOrBuildManagedCloudTemplateOptions,
    ): Promise<E2bTemplateReceipt> {
      state.buildCount += 1;
      state.receipt = {
        artifact_id: `e2b-template/${options.config.templateName}`,
        templateId: "tmpl-shared-offline",
        buildId: "build-shared-offline",
        inputHash: await computeManagedCloudTemplateHash(options.inputs),
        bakedInputs: [{ destination: "/home/user/anyharness", sha256: "b".repeat(64) }],
      };
      return state.receipt;
    },
  };
  return state;
}

function deps(
  pair: PairHarness,
  cleanupSharedTemplate?: NonNullable<ManagedCloudWorldDeps["cleanupSharedTemplate"]>,
): ManagedCloudWorldDeps {
  return {
    litellmFetch,
    ec2Provisioner: provisioner(),
    ssh,
    resolveTemplate: pair.resolveTemplate,
    probeHealth: async () => ({ ok: true, version: SERVER_VERSION }),
    chromiumLauncher,
    spawn,
    rendererFetch,
    extractExec,
    rendererPort: 43123,
    cleanupSharedTemplate,
  };
}

async function constructStage(options: {
  runDir: string;
  map: CandidateBuildMapV1;
  pair: PairHarness;
  mode: "shared_producer" | "shared_consumer";
  journalPath: string;
  cleanupSharedTemplate?: NonNullable<ManagedCloudWorldDeps["cleanupSharedTemplate"]>;
}) {
  const stageSecrets = await secrets(options.runDir);
  return constructManagedCloudWorld({
    run: RUN,
    map: options.map,
    litellm: LITELLM,
    aws: AWS,
    e2b: e2bConfig(stageSecrets.e2b),
    github: githubConfig(stageSecrets.github),
    tls: TEST_QUALIFICATION_TLS,
    runDir: options.runDir,
    templateCustody: { mode: options.mode, journalPath: options.journalPath },
    deps: deps(options.pair, options.cleanupSharedTemplate),
  });
}

test("shared producer and consumer reuse one exact template and release custody after safe cleanup", async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "mc-shared-source-"));
  const parentRunDir = await mkdtemp(path.join(os.tmpdir(), "mc-shared-run-"));
  const journalPath = sharedTemplateCustodyPath(parentRunDir);
  try {
    const map = await candidateMap(sourceDir);
    const pair = pairHarness();
    const producer = await constructStage({
      runDir: path.join(parentRunDir, "producer"),
      map,
      pair,
      mode: "shared_producer",
      journalPath,
    });
    assert.equal(pair.buildCount, 1);
    const producerReceipt = structuredClone(producer.artifacts.template);
    const acquiredBeforeClose = await loadSharedTemplateCustody(journalPath);
    assert.equal(acquiredBeforeClose.state, "acquired");
    assert.deepEqual(acquiredBeforeClose.receipt, producerReceipt);

    const producerCleanup = await producer.close();
    assert.equal(producerCleanup.failed, 0);
    assert.equal(producerCleanup.templateDeleted, false);
    assert.equal(producerCleanup.templateCustodyTransferred, true);
    assert.equal((await loadSharedTemplateCustody(journalPath)).state, "acquired");

    const cleanupEvents: string[] = [];
    const consumer = await constructStage({
      runDir: path.join(parentRunDir, "consumer"),
      map,
      pair,
      mode: "shared_consumer",
      journalPath,
      cleanupSharedTemplate: async (receipt) => {
        assert.deepEqual(receipt, producerReceipt);
        assert.equal((await loadSharedTemplateCustody(journalPath)).state, "acquired");
        cleanupEvents.push("provider-safe-cleanup");
      },
    });
    assert.equal(pair.buildCount, 1, "the consumer must not rebuild the template");
    assert.deepEqual(consumer.artifacts.template, producerReceipt);

    const consumerCleanup = await consumer.close();
    cleanupEvents.push(`journal-${(await loadSharedTemplateCustody(journalPath)).state}`);
    assert.deepEqual(cleanupEvents, ["provider-safe-cleanup", "journal-released"]);
    assert.equal(consumerCleanup.failed, 0);
    assert.equal(consumerCleanup.templateDeleted, true);
    assert.equal(consumerCleanup.templateCustodyTransferred, false);
    const released = await loadSharedTemplateCustody(journalPath);
    assert.equal(released.state, "released");
    assert.deepEqual(released.receipt, producerReceipt);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(parentRunDir, { recursive: true, force: true });
  }
});

test("consumer cleanup failure preserves acquired custody and returns non-green cleanup", async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "mc-shared-failure-source-"));
  const parentRunDir = await mkdtemp(path.join(os.tmpdir(), "mc-shared-failure-run-"));
  const journalPath = sharedTemplateCustodyPath(parentRunDir);
  try {
    const map = await candidateMap(sourceDir);
    const pair = pairHarness();
    const producer = await constructStage({
      runDir: path.join(parentRunDir, "producer"),
      map,
      pair,
      mode: "shared_producer",
      journalPath,
    });
    await producer.close();

    const consumer = await constructStage({
      runDir: path.join(parentRunDir, "consumer"),
      map,
      pair,
      mode: "shared_consumer",
      journalPath,
      cleanupSharedTemplate: async () => {
        throw new Error("provider absence could not be proven");
      },
    });
    const cleanup = await consumer.close();
    // The provider cleanup itself fails, then run_directory is deliberately
    // skipped so the acquired custody journal + ledger survive for replay.
    assert.equal(cleanup.failed, 2);
    assert.equal(cleanup.templateDeleted, false);
    assert.equal(cleanup.templateCustodyTransferred, false);
    assert.equal((await loadSharedTemplateCustody(journalPath)).state, "acquired");
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(parentRunDir, { recursive: true, force: true });
  }
});
