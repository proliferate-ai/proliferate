import assert from "node:assert/strict";
import { test } from "node:test";

import { isWorldBackedRun, resolveLocalFunctionalWorldInputs } from "./world-boot.js";
import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { EnvResolution } from "../../config/env-resolution.js";

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
