import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Browser } from "playwright";

import type { CandidateBuildArtifactV1, CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { SelfHostCandidateSet } from "../../artifacts/selfhost-candidate-set.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import { CLEANUP_LEDGER_FILENAME } from "../local-workspace/cleanup-ledger.js";
import type { Exec } from "../local-workspace/docker.js";
import type { LocalWorldPorts } from "../local-workspace/ports.js";
import type { ReadinessFetch, SpawnLike } from "../local-workspace/processes.js";
import type { ChromiumLauncher } from "../local-workspace/renderer.js";
import { TEST_QUALIFICATION_TLS } from "../qualification-tls.test-fixture.js";
import type { Ec2Exec } from "./ec2.js";
import type { Route53Exec } from "./dns.js";
import {
  SELFHOST_BUNDLE_SHA256SUMS_FILENAME,
  constructSelfHostWorld,
  type SelfHostWorldDeps,
  type SshTransport,
} from "./world.js";

const RUN: RunIdentityV1 = {
  run_id: "selfhost-run-1",
  shard_id: "shard-0",
  attempt: 1,
  source_sha: "0".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const PORTS: LocalWorldPorts = { server: 8200, postgres: 8201, redis: 8202, anyharness: 8203, renderer: 8204 };

const ANYHARNESS_VERSION = "9.9.9";
const AWS = { region: "us-east-1", instanceType: "t3.small", hostedZoneId: "Z123", zone: "qualification.proliferate.com" };
const SSH = { sshUser: "ubuntu" };

async function fileArtifact(dir: string, id: string, version: string, content: string): Promise<CandidateBuildArtifactV1> {
  const filePath = path.join(dir, encodeURIComponent(id));
  await writeFile(filePath, content);
  return {
    artifact_id: id,
    version,
    sha256: createHash("sha256").update(content).digest("hex"),
    locator: { kind: "local_file", path: filePath },
  };
}

async function buildMap(dir: string): Promise<CandidateBuildMapV1> {
  const bundle = await fileArtifact(dir, "selfhost-bundle/linux-amd64", "1.2.3", "deploy-bundle-bytes");
  await writeFile(
    path.join(dir, SELFHOST_BUNDLE_SHA256SUMS_FILENAME),
    `${bundle.sha256}  proliferate-deploy.tar.gz\n`,
  );
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "0".repeat(40),
    artifacts: [
      await fileArtifact(dir, "server/linux-amd64", "1.2.3", "server-archive-bytes"),
      bundle,
      await fileArtifact(dir, "anyharness/host-target", ANYHARNESS_VERSION, "anyharness-bytes"),
      await fileArtifact(dir, "desktop-renderer/browser", "0.1.0", "renderer-tar-bytes"),
    ],
  };
}

function fakeResolveSet(map: CandidateBuildMapV1): SelfHostCandidateSet {
  const byPrefix = (prefix: string) => map.artifacts.find((a) => a.artifact_id.startsWith(prefix))!;
  return {
    serverImage: byPrefix("server/"),
    bundle: byPrefix("selfhost-bundle/"),
    anyharness: byPrefix("anyharness/"),
    desktopRenderer: map.artifacts.find((a) => a.artifact_id === "desktop-renderer/browser")!,
  };
}

function fakeEc2Exec(calls: string[][]): Ec2Exec {
  return {
    async run(args) {
      const argv = [...args];
      calls.push(argv);
      const joined = argv.join(" ");
      if (argv[0] === "ssm") return "ami-0abc\n";
      if (joined.includes("create-key-pair")) return "-----KEY-----\n";
      if (joined.includes("create-security-group")) return "sg-0abc\n";
      if (joined.includes("run-instances")) return "i-0abc\n";
      if (joined.includes("describe-instances") && joined.includes("PublicIpAddress")) return "203.0.113.50\n";
      if (joined.includes("describe-instances")) return "i-0abc\n";
      return "";
    },
  };
}

function readinessFetch(anyharnessVersion = ANYHARNESS_VERSION): ReadinessFetch {
  return async (url) => {
    if (url.includes(`:${PORTS.anyharness}/health`)) {
      return { ok: true, status: 200, json: async () => ({ status: "ok", version: anyharnessVersion, runtimeHome: "/iso" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
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
  return async () => ({ close: async () => { state.closed = true; } }) as unknown as Browser;
}

function fakeSshFactory(commands: string[]): (box: unknown, keyPath: string) => SshTransport {
  return () => ({
    async run(command) {
      commands.push(command);
      return "";
    },
    async scp() {
      // no-op transport in unit tests
    },
  });
}

interface Harness {
  deps: SelfHostWorldDeps;
  ec2Calls: string[][];
  route53Calls: string[][];
  sshCommands: string[];
  spawnState: { killed: number };
  browserState: { closed: boolean };
}

function harness(anyharnessVersion = ANYHARNESS_VERSION): Harness {
  const ec2Calls: string[][] = [];
  const route53Calls: string[][] = [];
  const sshCommands: string[] = [];
  const spawnState = { killed: 0 };
  const browserState = { closed: false };
  return {
    ec2Calls,
    route53Calls,
    sshCommands,
    spawnState,
    browserState,
    deps: {
      ec2Exec: fakeEc2Exec(ec2Calls),
      route53Exec: { async run(args) { route53Calls.push([...args]); return ""; } } satisfies Route53Exec,
      publicIpResolver: async () => "198.51.100.7",
      resolveCandidateSet: fakeResolveSet,
      sshFactory: fakeSshFactory(sshCommands) as SelfHostWorldDeps["sshFactory"],
      spawn: fakeSpawn(spawnState),
      chromiumLauncher: fakeChromium(browserState),
      extractExec: (async () => ({ stdout: "", stderr: "" })) as Exec,
      readinessFetch: readinessFetch(anyharnessVersion),
    },
  };
}

test("constructSelfHostWorld provisions infra + stands up runtime/renderer/control (does not install)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-run-"));
  try {
    const map = await buildMap(src);
    const h = harness();
    const world = await constructSelfHostWorld({
      run: RUN,
      map,
      runDir,
      ports: PORTS,
      aws: AWS,
      ssh: SSH,
      tls: TEST_QUALIFICATION_TLS,
      deps: h.deps,
    });

    assert.equal(world.kind, "selfhost");
    // The API base is the deterministic TLS origin of the run subdomain.
    assert.match(world.api.baseUrl, /^https:\/\/sh-selfhost-run-1-shard-0-[0-9a-f]{8}\.qualification\.proliferate\.com$/);
    // The controller-local AnyHarness is a LOCAL origin, recorded separately.
    assert.equal(world.runtime.baseUrl, `http://127.0.0.1:${PORTS.anyharness}`);
    assert.equal(world.renderer.baseUrl, `http://127.0.0.1:${PORTS.renderer}`);
    assert.equal(world.artifacts.serverImage.version, "1.2.3");
    assert.equal(world.artifacts.anyharness.version, ANYHARNESS_VERSION);
    await access(world.artifacts.bundle.path);
    assert.equal(
      await readFile(world.artifacts.bundleSha256SumsPath, "utf8"),
      `${world.artifacts.bundle.sha256}  proliferate-deploy.tar.gz\n`,
    );
    await access(path.join(runDir, CLEANUP_LEDGER_FILENAME));
    // The SSH readiness probe ran (cloud-init gate), and the control handle is wired.
    assert.ok(h.sshCommands.some((c) => c.includes("selfhost-ready") && c.includes("docker compose version")));
    assert.equal(typeof world.control.readSetupToken, "function");
    // The box + DNS were provisioned but the shipped installer was NOT run at
    // construction (no docker-load / install.sh over SSH yet).
    assert.ok(!h.sshCommands.some((c) => c.includes("install.sh")));
    assert.ok(h.ec2Calls.some((c) => c.join(" ").includes("run-instances")));
    assert.ok(h.route53Calls.some((c) => c.join(" ").includes("change-resource-record-sets")));

    const evidence = await world.close();
    assert.equal(evidence.failed, 0);
    assert.equal(evidence.ec2Terminated, true);
    assert.equal(evidence.securityGroupDeleted, true);
    assert.equal(evidence.keyPairDeleted, true);
    assert.equal(evidence.route53RecordDeleted, true);
    assert.equal(evidence.browserClosed, true);
    assert.equal(evidence.processesStopped, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.equal(h.browserState.closed, true);
    assert.ok(h.spawnState.killed >= 2); // anyharness + renderer terminated
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a missing bundle checksum sibling fails before AWS provisioning", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-run-"));
  try {
    const map = await buildMap(src);
    await rm(path.join(src, SELFHOST_BUNDLE_SHA256SUMS_FILENAME));
    const h = harness();
    await assert.rejects(
      constructSelfHostWorld({
        run: RUN,
        map,
        runDir,
        ports: PORTS,
        aws: AWS,
        ssh: SSH,
        tls: TEST_QUALIFICATION_TLS,
        deps: h.deps,
      }),
      /Could not materialize self-hosted-assets\.SHA256SUMS/,
    );
    assert.equal(h.ec2Calls.length, 0);
    await access(map.artifacts[0]!.locator.path);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an invalid bundle checksum manifest fails before AWS provisioning", async (t) => {
  const cases = [
    ["wrong bundle digest", () => `${"f".repeat(64)}  proliferate-deploy.tar.gz\n`],
    ["missing bundle entry", () => `${"e".repeat(64)}  anyharness-aarch64-unknown-linux-musl.tar.gz\n`],
    [
      "duplicate bundle entry",
      (sha: string) => `${sha}  proliferate-deploy.tar.gz\n${sha}  proliferate-deploy.tar.gz\n`,
    ],
    ["malformed checksum line", () => "not-a-checksum  proliferate-deploy.tar.gz\n"],
  ] as const;

  for (const [label, sumsContent] of cases) {
    await t.test(label, async () => {
      const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
      const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-run-"));
      try {
        const map = await buildMap(src);
        const bundle = map.artifacts.find((artifact) => artifact.artifact_id === "selfhost-bundle/linux-amd64")!;
        await writeFile(path.join(src, SELFHOST_BUNDLE_SHA256SUMS_FILENAME), sumsContent(bundle.sha256));
        const h = harness();
        await assert.rejects(
          constructSelfHostWorld({
            run: RUN,
            map,
            runDir,
            ports: PORTS,
            aws: AWS,
            ssh: SSH,
            tls: TEST_QUALIFICATION_TLS,
            deps: h.deps,
          }),
          /does not contain exactly one valid proliferate-deploy\.tar\.gz entry/,
        );
        assert.equal(h.ec2Calls.length, 0);
        assert.equal(h.route53Calls.length, 0);
      } finally {
        await rm(src, { recursive: true, force: true });
        await rm(runDir, { recursive: true, force: true });
      }
    });
  }
});

test("an invalid candidate map starts no world (no dirs, no ledger, no AWS side effects)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-run-"));
  try {
    const map = await buildMap(src);
    const h = harness();
    h.deps.resolveCandidateSet = () => {
      throw new Error("Candidate build map is missing the required selfhost-bundle artifact.");
    };
    await assert.rejects(
      constructSelfHostWorld({
        run: RUN,
        map,
        runDir,
        ports: PORTS,
        aws: AWS,
        ssh: SSH,
        tls: TEST_QUALIFICATION_TLS,
        deps: h.deps,
      }),
      /selfhost-bundle/,
    );
    assert.equal(h.ec2Calls.length, 0); // no AWS touched
    assert.equal(h.route53Calls.length, 0);
    await assert.rejects(access(path.join(runDir, CLEANUP_LEDGER_FILENAME))); // no ledger
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an AnyHarness version mismatch fails startup and runs registered cleanup (AWS torn down)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-run-"));
  try {
    const map = await buildMap(src);
    const h = harness("0.0.0-wrong");
    await assert.rejects(
      constructSelfHostWorld({
        run: RUN,
        map,
        runDir,
        ports: PORTS,
        aws: AWS,
        ssh: SSH,
        tls: TEST_QUALIFICATION_TLS,
        deps: h.deps,
      }),
      /AnyHarness reported version "0.0.0-wrong" does not match/,
    );
    // Cleanup ran: the box was terminated and the SG + key pair deleted.
    const joined = h.ec2Calls.map((c) => c.join(" "));
    assert.ok(joined.some((c) => c.includes("terminate-instances")));
    assert.ok(joined.some((c) => c.includes("delete-security-group")));
    assert.ok(joined.some((c) => c.includes("delete-key-pair")));
    assert.ok(h.route53Calls.some((c) => c.join(" ").includes("change-resource-record-sets")));
    assert.ok(h.spawnState.killed >= 1); // the launched anyharness was terminated
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("two concurrent worlds collide on nothing (distinct key names, DNS records, run dirs)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-src-"));
  const runDirA = await mkdtemp(path.join(os.tmpdir(), "sh-a-"));
  const runDirB = await mkdtemp(path.join(os.tmpdir(), "sh-b-"));
  try {
    const map = await buildMap(src);
    const a = harness();
    const b = harness();
    const worldA = await constructSelfHostWorld({
      run: RUN,
      map,
      runDir: runDirA,
      ports: PORTS,
      aws: AWS,
      ssh: SSH,
      tls: TEST_QUALIFICATION_TLS,
      deps: a.deps,
    });
    const worldB = await constructSelfHostWorld({
      run: { ...RUN, run_id: "selfhost-run-2" },
      map,
      runDir: runDirB,
      ports: PORTS,
      aws: AWS,
      ssh: SSH,
      tls: TEST_QUALIFICATION_TLS,
      deps: b.deps,
    });

    const keyA = a.ec2Calls.find((c) => c.join(" ").includes("create-key-pair"))!.join(" ");
    const keyB = b.ec2Calls.find((c) => c.join(" ").includes("create-key-pair"))!.join(" ");
    assert.notEqual(keyA, keyB);
    assert.notEqual(worldA.api.baseUrl, worldB.api.baseUrl);

    await worldA.close();
    await worldB.close();
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDirA, { recursive: true, force: true });
    await rm(runDirB, { recursive: true, force: true });
  }
});
