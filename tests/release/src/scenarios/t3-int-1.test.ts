import assert from "node:assert/strict";
import { test } from "node:test";

import { t3Int1 } from "./t3-int-1.js";
import { ScenarioExpectedFailError } from "./types.js";
import type { ScenarioRunContext } from "./types.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { PlannedCellV1 } from "../runner/result.js";

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  return {
    all: [],
    missing: [],
    present: (name) => vars[name] !== undefined,
    get: (name) => vars[name],
    require: (name) => {
      const value = vars[name];
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
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv({ RELEASE_E2E_INTEGRATION_API_KEY: "sk-test", RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://x" }),
    candidateBuildMap: null,
    runIdentity: null,
    runDir: null,
    ports: null,
    ...overrides,
  };
}

function fakeCell(harness: string, runtimeLane: "local" | "sandbox" = "local"): PlannedCellV1 {
  return {
    cell_id: `T3-INT-1/${runtimeLane}/harness=${harness}`,
    scenario_id: "T3-INT-1",
    registry_flow_ref: "specs/developing/testing/scenarios.md#T3-INT-1",
    runtime_lane: runtimeLane,
    dimensions: { harness },
    required_env: [],
  };
}

test("t3Int1 is registered as a matrix scenario (leaf→matrix promotion)", () => {
  assert.equal(t3Int1.kind, "matrix");
});

test("expandCells: an explicit --agents selection produces one cell per selected harness", async () => {
  const specs = await t3Int1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude", "codex"] });
  assert.deepEqual(
    specs.map((spec) => spec.dimensions.harness),
    ["claude", "codex"],
  );
});

test("expandCells: agents=['all'] derives the catalog-driven harness set (audit ruling #4)", async () => {
  const specs = await t3Int1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["all"] });
  const harnesses = specs.map((spec) => spec.dimensions.harness);
  assert.ok(harnesses.length > 0);
  assert.ok(harnesses.includes("claude"));
  // Every child cell carries exactly one dimension key.
  for (const spec of specs) {
    assert.deepEqual(Object.keys(spec.dimensions), ["harness"]);
  }
});

test("runCells: the sandbox lane throws ScenarioExpectedFailError for the whole assigned batch, world-backed or not", async () => {
  const worldBackedCtx = fakeCtx({
    runtimeLane: "sandbox",
    candidateBuildMap: {} as never,
    runIdentity: {} as never,
    runDir: "/tmp/run",
    ports: {} as never,
  });
  await assert.rejects(
    () => t3Int1.runCells(worldBackedCtx, [fakeCell("claude", "sandbox")]),
    ScenarioExpectedFailError,
  );

  const diagnosticCtx = fakeCtx({ runtimeLane: "sandbox" });
  await assert.rejects(
    () => t3Int1.runCells(diagnosticCtx, [fakeCell("claude", "sandbox")]),
    ScenarioExpectedFailError,
  );
});

test("runCells: legacy diagnostic path (no candidate map) blocks every assigned cell cleanly when durable-user env is missing", async () => {
  const ctx = fakeCtx(); // candidateBuildMap: null -> !isWorldBackedRun
  const cells = [fakeCell("claude"), fakeCell("codex")];

  const outcomes = await t3Int1.runCells(ctx, cells);

  assert.equal(outcomes.length, 2);
  for (const [index, outcome] of outcomes.entries()) {
    assert.equal(outcome.cellId, cells[index]!.cell_id);
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.reason?.code, "scenario_blocked");
    assert.match(outcome.reason!.message, /RELEASE_E2E_SERVER_URL|RELEASE_E2E_DURABLE_USER_EMAIL/);
  }
});

test("runCells: a world-backed run dispatches to the LOCAL-7 functional collector, not the legacy lane", async () => {
  const ctx = fakeCtx({
    candidateBuildMap: {} as never,
    runIdentity: {} as never,
    runDir: "/tmp/run",
    ports: {} as never,
  });
  const cells = [fakeCell("claude")];

  // world-boot.ts (builders-ci's file) has not landed its real implementation
  // yet in this worktree — resolveLocalFunctionalWorldInputs still throws
  // "not implemented". That the dispatch REACHES it (rather than running the
  // legacy durable-user lane, which would instead return a clean blocked
  // outcome) is exactly what proves the isWorldBackedRun(ctx) branch fired.
  await assert.rejects(() => t3Int1.runCells(ctx, cells), /not implemented/);
});
