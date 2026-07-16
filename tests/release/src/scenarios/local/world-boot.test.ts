import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  AsyncMutex,
  bootLocalFunctionalWorld,
  isWorldBackedRun,
  resolveLocalFunctionalWorldInputs,
  worldDirSlug,
  type ConstructLocalWorldFn,
  type LocalFunctionalWorldInputs,
} from "./world-boot.js";
import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { EnvResolution } from "../../config/env-resolution.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";

// ── Fakes (offline: no world, browser, container, or network) ────────────────

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), locator: { kind: "local_file", path: "/tmp/server.tar" } },
      { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "1", sha256: "a".repeat(64), locator: { kind: "local_file", path: "/tmp/anyharness" } },
      { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), locator: { kind: "local_file", path: "/tmp/renderer.tar" } },
    ],
  };
}

function fakeEnv(overrides: Record<string, string | undefined> = {}): EnvResolution {
  const defaults: Record<string, string | undefined> = {
    AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
    AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
    AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
    ...overrides,
  };
  return {
    all: [],
    missing: [],
    present: (name) => defaults[name] !== undefined,
    get: (name) => defaults[name],
    require: (name) => {
      const value = defaults[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "local",
    runtimeLane: "local",
    desktop: "web",
    agents: ["all"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/run-1",
    ports: { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 },
    ...overrides,
  };
}

// ── isWorldBackedRun ─────────────────────────────────────────────────────────

test("isWorldBackedRun: true only when map, identity, runDir, and ports are all present", () => {
  assert.equal(isWorldBackedRun(fakeCtx()), true);
  assert.equal(isWorldBackedRun(fakeCtx({ candidateBuildMap: null })), false);
  assert.equal(isWorldBackedRun(fakeCtx({ runIdentity: null })), false);
  assert.equal(isWorldBackedRun(fakeCtx({ runDir: null })), false);
  assert.equal(isWorldBackedRun(fakeCtx({ ports: null })), false);
});

// ── resolveLocalFunctionalWorldInputs ────────────────────────────────────────

test("resolveLocalFunctionalWorldInputs: resolves the full world-construction inputs from a complete context", () => {
  const resolution = resolveLocalFunctionalWorldInputs(fakeCtx());
  assert.equal(resolution.ok, true);
  if (!resolution.ok) {
    return;
  }
  assert.equal(resolution.value.runDir, "/tmp/run-1");
  assert.deepEqual(resolution.value.ports, { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 });
  assert.equal(resolution.value.run.run_id, "local-run-1");
  assert.equal(resolution.value.litellm.adminBaseUrl, "https://admin.litellm.example");
  assert.equal(resolution.value.litellm.publicBaseUrl, "https://public.litellm.example");
  assert.equal(resolution.value.litellm.masterKey, "sk-test-master");
  assert.equal(resolution.value.map.artifacts.length, 3);
});

test("resolveLocalFunctionalWorldInputs: a missing candidate map is a typed failure, never a throw", () => {
  const resolution = resolveLocalFunctionalWorldInputs(fakeCtx({ candidateBuildMap: null }));
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.match(resolution.reason, /candidate build map/i);
});

test("resolveLocalFunctionalWorldInputs: a missing gateway env var is a typed failure, never a throw", () => {
  const resolution = resolveLocalFunctionalWorldInputs(
    fakeCtx({ env: fakeEnv({ AGENT_GATEWAY_LITELLM_MASTER_KEY: undefined }) }),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.match(resolution.reason, /AGENT_GATEWAY_LITELLM_MASTER_KEY/);
});

test("resolveLocalFunctionalWorldInputs: absent run identity / run dir / ports each fail cleanly", () => {
  for (const override of [{ runIdentity: null }, { runDir: null }, { ports: null }] as Array<Partial<ScenarioRunContext>>) {
    const resolution = resolveLocalFunctionalWorldInputs(fakeCtx(override));
    assert.equal(resolution.ok, false);
  }
});

// ── worldDirSlug ─────────────────────────────────────────────────────────────

test("worldDirSlug: slugifies a scenario id into a filesystem-safe subdir name", () => {
  assert.equal(worldDirSlug("T3-WT-1"), "t3-wt-1");
  assert.equal(worldDirSlug("T3-AUTHROUTE-1"), "t3-authroute-1");
  assert.equal(worldDirSlug("T3/CHAT 1!!"), "t3-chat-1");
  assert.equal(worldDirSlug("///"), "world"); // never empty
});

// ── AsyncMutex ───────────────────────────────────────────────────────────────

test("AsyncMutex: serializes holders FIFO — the next acquirer waits for release", async () => {
  const mutex = new AsyncMutex();
  const order: string[] = [];
  const releaseA = await mutex.acquire();
  const bAcquired = mutex.acquire().then((release) => {
    order.push("B-acquired");
    return release;
  });
  // B cannot acquire while A holds the lock, even after microtask flushes.
  await Promise.resolve();
  order.push("A-holds");
  assert.deepEqual(order, ["A-holds"]);
  releaseA();
  const releaseB = await bAcquired;
  assert.deepEqual(order, ["A-holds", "B-acquired"]);
  releaseB();
});

// ── bootLocalFunctionalWorld (mutex + worldRoot wiring) ───────────────────────

function fakeWorldInputs(runDir = "/tmp/run-x"): LocalFunctionalWorldInputs {
  return {
    map: fakeCandidateMap(),
    litellm: { adminBaseUrl: "http://admin", publicBaseUrl: "http://public", masterKey: "sk-master" },
    run: {
      run_id: "local-run-1",
      shard_id: "shard-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir,
    ports: { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 },
  };
}

function fakeReadyWorld(onClose: () => void): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    close: async () => {
      onClose();
      return {} as LocalWorldCleanupEvidence;
    },
  } as unknown as ReadyLocalWorld;
}

test("bootLocalFunctionalWorld: passes a per-scenario worldRoot under <runDir>/worlds/<slug>", async () => {
  let capturedWorldRoot: string | undefined;
  const construct: ConstructLocalWorldFn = async (opts) => {
    capturedWorldRoot = opts.worldRoot;
    return fakeReadyWorld(() => undefined);
  };
  const world = await bootLocalFunctionalWorld(fakeWorldInputs(), "T3-WT-1", construct);
  assert.equal(capturedWorldRoot, path.join("/tmp/run-x", "worlds", "t3-wt-1"));
  await world.close(); // release the module mutex for the next test
});

test("bootLocalFunctionalWorld: serializes world boots — never two worlds live at once", async () => {
  let active = 0;
  let maxActive = 0;
  const worldRoots: string[] = [];
  const construct: ConstructLocalWorldFn = async (opts) => {
    worldRoots.push(opts.worldRoot!);
    active += 1;
    maxActive = Math.max(maxActive, active);
    return fakeReadyWorld(() => {
      active -= 1;
    });
  };

  const p1 = bootLocalFunctionalWorld(fakeWorldInputs(), "T3-WT-1", construct);
  const p2 = bootLocalFunctionalWorld(fakeWorldInputs(), "T3-CHAT-1", construct);

  const w1 = await p1;
  // Second world must NOT have constructed while the first is still live.
  assert.equal(active, 1);
  assert.deepEqual(worldRoots, [path.join("/tmp/run-x", "worlds", "t3-wt-1")]);

  await w1.close(); // releasing the first world lets the second boot
  const w2 = await p2;
  assert.equal(active, 1);
  assert.deepEqual(worldRoots, [
    path.join("/tmp/run-x", "worlds", "t3-wt-1"),
    path.join("/tmp/run-x", "worlds", "t3-chat-1"),
  ]);
  await w2.close();
  assert.equal(active, 0);
  assert.equal(maxActive, 1); // the mutex kept the two boots from overlapping
});

test("bootLocalFunctionalWorld: releases the mutex when construction throws", async () => {
  await assert.rejects(
    bootLocalFunctionalWorld(fakeWorldInputs(), "T3-WT-1", async () => {
      throw new Error("docker load failed");
    }),
    /docker load failed/,
  );
  // A subsequent boot must proceed — proving the failed boot released the gate.
  let constructed = false;
  const world = await bootLocalFunctionalWorld(fakeWorldInputs(), "T3-CHAT-1", async () => {
    constructed = true;
    return fakeReadyWorld(() => undefined);
  });
  assert.equal(constructed, true);
  await world.close();
});
