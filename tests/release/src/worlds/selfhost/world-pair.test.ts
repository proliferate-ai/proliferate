import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Browser } from "playwright";

import type { CandidateBuildArtifactV1, CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { SelfHostCandidateSet } from "../../artifacts/selfhost-candidate-set.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import type { Exec } from "../local-workspace/docker.js";
import type { LocalWorldPorts } from "../local-workspace/ports.js";
import type { ReadinessFetch, SpawnLike } from "../local-workspace/processes.js";
import type { ChromiumLauncher } from "../local-workspace/renderer.js";
import { TEST_QUALIFICATION_TLS } from "../qualification-tls.test-fixture.js";
import type { Ec2Exec } from "./ec2.js";
import type { Route53Exec } from "./dns.js";
import {
  SECOND_WORLD_PORT_OFFSET,
  SELFHOST_BUNDLE_SHA256SUMS_FILENAME,
  constructSelfHostWorldPair,
  offsetLocalWorldPorts,
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
  return { artifact_id: id, version, sha256: createHash("sha256").update(content).digest("hex"), locator: { kind: "local_file", path: filePath } };
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

// Health-ready for ANY /health probe (server A binds PORTS.anyharness; server B
// binds the offset port), returning the matching AnyHarness version.
const readinessFetch: ReadinessFetch = async (url) => {
  if (url.includes("/health")) {
    return { ok: true, status: 200, json: async () => ({ status: "ok", version: ANYHARNESS_VERSION, runtimeHome: "/iso" }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

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

function fakeChromium(state: { closed: number }): ChromiumLauncher {
  return async () => ({ close: async () => { state.closed += 1; } }) as unknown as Browser;
}

function fakeSshFactory(): (box: unknown, keyPath: string) => SshTransport {
  return () => ({ async run() { return ""; }, async scp() {} });
}

function pairDeps(ec2Calls: string[][]): SelfHostWorldDeps {
  return {
    ec2Exec: fakeEc2Exec(ec2Calls),
    route53Exec: { async run() { return ""; } } satisfies Route53Exec,
    publicIpResolver: async () => "198.51.100.7",
    resolveCandidateSet: fakeResolveSet,
    sshFactory: fakeSshFactory() as SelfHostWorldDeps["sshFactory"],
    spawn: fakeSpawn({ killed: 0 }),
    chromiumLauncher: fakeChromium({ closed: 0 }),
    extractExec: (async () => ({ stdout: "", stderr: "" })) as Exec,
    readinessFetch,
  };
}

test("offsetLocalWorldPorts: offsets every port, stays in range, and never collides with the source", () => {
  const b = offsetLocalWorldPorts(PORTS);
  assert.equal(b.anyharness, PORTS.anyharness + SECOND_WORLD_PORT_OFFSET);
  assert.equal(b.renderer, PORTS.renderer + SECOND_WORLD_PORT_OFFSET);
  for (const key of ["server", "postgres", "redis", "anyharness", "renderer"] as const) {
    assert.ok(b[key] >= 1024 && b[key] <= 65_535, `${key} out of range: ${b[key]}`);
    assert.notEqual(b[key], PORTS[key]);
  }
  // A near-max source port wraps back into the valid range.
  const high = offsetLocalWorldPorts({ server: 65_500, postgres: 65_500, redis: 65_500, anyharness: 65_500, renderer: 65_500 });
  assert.ok(high.anyharness >= 1024 && high.anyharness <= 65_535);
});

test("constructSelfHostWorldPair: A keeps the baked subdomain, B is fully distinct (names, subdomain, ports)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-pair-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-pair-run-"));
  try {
    const map = await buildMap(src);
    const ec2Calls: string[][] = [];
    const pair = await constructSelfHostWorldPair({
      run: RUN,
      map,
      runDir,
      ports: PORTS,
      aws: AWS,
      ssh: SSH,
      tls: TEST_QUALIFICATION_TLS,
      deps: pairDeps(ec2Calls),
    });

    // Server A's API origin is the run/shard-UNCHANGED subdomain (the origin the
    // renderer's baked VITE_PROLIFERATE_API_BASE_URL points at).
    assert.match(pair.a.api.baseUrl, /^https:\/\/sh-selfhost-run-1-shard-0-[0-9a-f]{8}\.qualification\.proliferate\.com$/);
    // Server B's API origin uses the shard-suffixed identity → a distinct subdomain.
    assert.match(pair.b.api.baseUrl, /^https:\/\/sh-selfhost-run-1-shard-0-b-[0-9a-f]{8}\.qualification\.proliferate\.com$/);
    assert.notEqual(pair.a.api.baseUrl, pair.b.api.baseUrl);

    // B's controller-local AnyHarness bound on the offset port.
    assert.equal(pair.a.runtime.baseUrl, `http://127.0.0.1:${PORTS.anyharness}`);
    assert.equal(pair.b.runtime.baseUrl, `http://127.0.0.1:${PORTS.anyharness + SECOND_WORLD_PORT_OFFSET}`);

    // Two distinct EC2 key pairs were created (one per box).
    const keyNames = ec2Calls
      .filter((c) => c.join(" ").includes("create-key-pair"))
      .map((c) => c[c.indexOf("--key-name") + 1]);
    assert.equal(keyNames.length, 2);
    assert.notEqual(keyNames[0], keyNames[1]);

    // Both boxes tear down cleanly and independently.
    const cleanupA = await pair.a.close();
    const cleanupB = await pair.b.close();
    for (const cleanup of [cleanupA, cleanupB]) {
      assert.equal(cleanup.failed, 0);
      assert.equal(cleanup.ec2Terminated, true);
      assert.equal(cleanup.route53RecordDeleted, true);
    }
    assert.notEqual(cleanupA.ledgerIdHash, cleanupB.ledgerIdHash);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("constructSelfHostWorldPair: a failure building server B tears down server A (no leak)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "sh-pair-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "sh-pair-run-"));
  try {
    const map = await buildMap(src);
    const ec2Calls: string[][] = [];
    const deps = pairDeps(ec2Calls);
    let builds = 0;
    const okResolve = deps.resolveCandidateSet!;
    // Fail only the SECOND world construction (server B).
    deps.resolveCandidateSet = (m) => {
      builds += 1;
      if (builds === 2) {
        throw new Error("server B candidate set unresolved");
      }
      return okResolve(m);
    };
    await assert.rejects(
      constructSelfHostWorldPair({
        run: RUN,
        map,
        runDir,
        ports: PORTS,
        aws: AWS,
        ssh: SSH,
        tls: TEST_QUALIFICATION_TLS,
        deps,
      }),
      /server B candidate set unresolved/,
    );
    // Server A was built then torn down (its box terminated) before the rethrow.
    assert.ok(ec2Calls.some((c) => c.join(" ").includes("terminate-instances")), "server A should be terminated on B failure");
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});
