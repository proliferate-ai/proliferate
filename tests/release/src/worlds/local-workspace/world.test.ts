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
import type { FetchLike, HttpResponseLike } from "../../services/qualification-litellm.js";
import { CLEANUP_LEDGER_FILENAME } from "./cleanup-ledger.js";
import type { Exec } from "./docker.js";
import type { ReadinessFetch, SpawnLike } from "./processes.js";
import type { ChromiumLauncher } from "./renderer.js";
import { constructLocalWorld, type LocalWorldDeps, type LocalWorldPorts } from "./world.js";

const RUN: RunIdentityV1 = {
  run_id: "local-run-1",
  shard_id: "shard-0",
  attempt: 1,
  source_sha: "0".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const PORTS: LocalWorldPorts = { server: 8100, postgres: 8101, redis: 8102, anyharness: 8103, renderer: 8104 };

const SERVER_VERSION = "1.2.3";
const ANYHARNESS_VERSION = "9.9.9";

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
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "0".repeat(40),
    artifacts: [
      await fileArtifact(dir, "server/linux-amd64", SERVER_VERSION, "server-tar-bytes"),
      await fileArtifact(dir, "anyharness/host-target", ANYHARNESS_VERSION, "anyharness-bytes"),
      await fileArtifact(dir, "desktop-renderer/browser", "0.1.0", "renderer-tar-bytes"),
    ],
  };
}

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/** LiteLLM fake: preflight (liveness + models) and subject deletion. */
function litellmFetch(): FetchLike {
  return async (url) => {
    if (url.includes("/health/liveliness")) return jsonResponse({ status: "connected" });
    if (url.includes("/v1/models")) return jsonResponse({ data: [{ id: "claude-haiku-4-5" }] });
    if (url.includes("/delete")) return jsonResponse({});
    return jsonResponse({ error: { message: "unrouted" } }, 404);
  };
}

/** Readiness fake for server, anyharness, and renderer, routed by port. */
function readinessFetch(anyharnessVersion = ANYHARNESS_VERSION): ReadinessFetch {
  return async (url) => {
    if (url.includes(`:${PORTS.server}/health`)) {
      return { ok: true, status: 200, json: async () => ({ status: "ok", version: SERVER_VERSION }) };
    }
    if (url.includes(`:${PORTS.anyharness}/health`)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", version: anyharnessVersion, runtimeHome: "/isolated" }),
      };
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
    child.pid = 1000 + state.killed;
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

function fakeExec(argv: string[][]): Exec {
  return async (file, args) => {
    argv.push([file, ...args]);
    const joined = args.join(" ");
    if (joined.includes("load")) return { stdout: "Loaded image: srv:candidate\n", stderr: "" };
    if (joined.includes("pg_isready")) return { stdout: "accepting connections", stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

function fakeChromium(state: { closed: boolean }): ChromiumLauncher {
  return async () => ({ close: async () => { state.closed = true; } }) as unknown as Browser;
}

interface Harness {
  deps: LocalWorldDeps;
  argv: string[][];
  spawnState: { killed: number };
  browserState: { closed: boolean };
}

function harness(anyharnessVersion = ANYHARNESS_VERSION): Harness {
  const argv: string[][] = [];
  const spawnState = { killed: 0 };
  const browserState = { closed: false };
  return {
    argv,
    spawnState,
    browserState,
    deps: {
      litellmFetch: litellmFetch(),
      dockerExec: fakeExec(argv),
      readinessFetch: readinessFetch(anyharnessVersion),
      spawn: fakeSpawn(spawnState),
      extractExec: async () => ({ stdout: "", stderr: "" }),
      chromiumLauncher: fakeChromium(browserState),
    },
  };
}

test("constructLocalWorld runs the ordered startup and returns a ready handle", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "world-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "world-run-"));
  try {
    const map = await buildMap(src);
    const h = harness();
    const world = await constructLocalWorld({ run: RUN, map, litellm: LITELLM, runDir, ports: PORTS, deps: h.deps });

    assert.equal(world.kind, "local-workspace");
    assert.equal(world.artifacts.server.version, SERVER_VERSION);
    assert.equal(world.artifacts.anyharness.version, ANYHARNESS_VERSION);
    assert.equal(world.api.baseUrl, `http://127.0.0.1:${PORTS.server}`);
    assert.equal(world.runtime.baseUrl, `http://127.0.0.1:${PORTS.anyharness}`);
    assert.equal(world.renderer.baseUrl, `http://127.0.0.1:${PORTS.renderer}`);
    // Re-hashed materialized copies live under the run dir, marked executable.
    await access(world.artifacts.anyharness.path);
    // Durable ledger written.
    await access(path.join(runDir, CLEANUP_LEDGER_FILENAME));
    // The real first-run setup token is copied out of the Server container to
    // <runDir>/setup-token (consumed by the actor fixture's real /setup claim).
    const cp = h.argv.find((cmd) => cmd[0] === "docker" && cmd[1] === "cp");
    assert.ok(cp, "expected a docker cp of the setup token");
    assert.equal(cp!.at(-1), path.join(runDir, "setup-token"));

    // A fresh actor enrolled for cleanup, then a full green teardown.
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
    assert.equal(evidence.virtualKeyDeleted, true);
    assert.equal(evidence.litellmSubjectsDeleted, true);
    assert.equal(evidence.browserClosed, true);
    assert.equal(evidence.processesStopped, true);
    assert.equal(evidence.containersRemoved, true);
    assert.equal(evidence.localPathsRemoved, true);
    assert.equal(h.browserState.closed, true);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

const LITELLM = { adminBaseUrl: "http://admin", publicBaseUrl: "http://public", masterKey: "sk-master" };

test("a version mismatch fails startup and runs registered cleanup", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "world-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "world-run-"));
  try {
    const map = await buildMap(src);
    const h = harness("0.0.0-wrong");
    await assert.rejects(
      constructLocalWorld({ run: RUN, map, litellm: LITELLM, runDir, ports: PORTS, deps: h.deps }),
      /AnyHarness reported version "0.0.0-wrong" does not match/,
    );
    // Cleanup ran: the launched anyharness process was terminated and the
    // containers were removed.
    assert.ok(h.spawnState.killed >= 1);
    assert.ok(h.argv.some((cmd) => cmd.includes("rm") || (cmd.includes("network") && cmd.includes("rm"))));
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("an invalid map starts no world (no preflight, no docker, no ledger)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "world-src-"));
  const runDir = await mkdtemp(path.join(os.tmpdir(), "world-run-"));
  try {
    const map = await buildMap(src);
    map.artifacts.push({
      artifact_id: "unexpected/extra",
      version: "1",
      sha256: "a".repeat(64),
      locator: { kind: "local_file", path: map.artifacts[0].locator.path },
    });
    const h = harness();
    let litellmCalled = false;
    h.deps.litellmFetch = async (url) => {
      litellmCalled = true;
      return jsonResponse({});
    };
    await assert.rejects(
      constructLocalWorld({ run: RUN, map, litellm: LITELLM, runDir, ports: PORTS, deps: h.deps }),
      /unexpected artifact/,
    );
    assert.equal(litellmCalled, false); // preflight never ran
    assert.equal(h.argv.length, 0); // docker never touched
    await assert.rejects(access(path.join(runDir, CLEANUP_LEDGER_FILENAME))); // no ledger
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  }
});

test("distinct runs get distinct Docker networks (isolation by run identity)", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "world-src-"));
  const runDirA = await mkdtemp(path.join(os.tmpdir(), "world-a-"));
  const runDirB = await mkdtemp(path.join(os.tmpdir(), "world-b-"));
  try {
    const map = await buildMap(src);
    const a = harness();
    const b = harness();
    const worldA = await constructLocalWorld({ run: RUN, map, litellm: LITELLM, runDir: runDirA, ports: PORTS, deps: a.deps });
    const worldB = await constructLocalWorld({
      run: { ...RUN, run_id: "local-run-2" },
      map,
      litellm: LITELLM,
      runDir: runDirB,
      ports: PORTS,
      deps: b.deps,
    });
    const netA = a.argv.find((cmd) => cmd.includes("network") && cmd.includes("create"))?.at(-1);
    const netB = b.argv.find((cmd) => cmd.includes("network") && cmd.includes("create"))?.at(-1);
    assert.ok(netA && netB && netA !== netB);
    await worldA.close();
    await worldB.close();
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(runDirA, { recursive: true, force: true });
    await rm(runDirB, { recursive: true, force: true });
  }
});
