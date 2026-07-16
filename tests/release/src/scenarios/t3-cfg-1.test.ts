import assert from "node:assert/strict";
import { test } from "node:test";

import { t3Cfg1 } from "./t3-cfg-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { EnvResolution } from "../config/env-resolution.js";

function fakeEnv(): EnvResolution {
  return {
    all: [],
    missing: [],
    present: () => false,
    get: () => undefined,
    require: (name) => {
      throw new Error(`missing ${name}`);
    },
  };
}

/** A diagnostic run: no candidate map, so `isWorldBackedRun` is false and the
 * legacy branch runs. */
function diagnosticCtx(): ScenarioRunContext {
  return {
    targetLane: "local",
    runtimeLane: "local",
    desktop: "web",
    agents: ["all"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: null,
    runIdentity: null,
    runDir: null,
    ports: null,
  };
}

function cell(harness: string): PlannedCellV1 {
  return {
    cell_id: `T3-CFG-1/local/harness=${harness}`,
    scenario_id: "T3-CFG-1",
    registry_flow_ref: "specs/developing/testing/scenarios.md#T3-CFG-1",
    runtime_lane: "local",
    dimensions: { harness },
    required_env: [],
  };
}

test("T3-CFG-1 is a local-only matrix with no gated env (legacy diagnostic must stay ungated)", () => {
  assert.equal(t3Cfg1.id, "T3-CFG-1");
  assert.equal(t3Cfg1.kind, "matrix");
  assert.deepEqual([...t3Cfg1.lanes], ["local"]);
  assert.deepEqual([...t3Cfg1.requiredEnv], []);
});

test("T3-CFG-1 expandCells fans out one cell per selected harness", async () => {
  if (t3Cfg1.kind !== "matrix") throw new Error("expected matrix");
  const specs = await t3Cfg1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude", "grok"] });
  assert.deepEqual(specs, [{ dimensions: { harness: "claude" } }, { dimensions: { harness: "grok" } }]);
});

test("T3-CFG-1 planCell prefixes every step with the cell id", () => {
  if (t3Cfg1.kind !== "matrix") throw new Error("expected matrix");
  const steps = t3Cfg1.planCell({ runtimeLane: "local", desktop: "web", agents: ["claude"] }, cell("claude"));
  assert.ok(steps.length >= 4);
  for (const step of steps) {
    assert.ok(step.description.startsWith("[claude]"));
  }
});

test("T3-CFG-1 diagnostic run blocks non-claude cells (legacy path covers claude only)", async () => {
  if (t3Cfg1.kind !== "matrix") throw new Error("expected matrix");
  const outcomes = await t3Cfg1.runCells(diagnosticCtx(), [cell("grok")]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.status, "blocked");
  assert.equal(outcomes[0]!.reason?.code, "scenario_blocked");
  assert.match(outcomes[0]!.reason?.message ?? "", /diagnostic path covers the representative claude harness only/);
});
