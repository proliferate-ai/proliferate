import assert from "node:assert/strict";
import { test } from "node:test";

import { t3Repo1 } from "./t3-repo-1.js";
import { ScenarioBlockedError } from "./types.js";
import type { ScenarioRunContext } from "./types.js";
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
 * legacy repo-environment branch runs. */
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

// Regression for the strict local-functional preflight cascade (2026-07-16,
// run 29483042778): a scenario-level requiredEnv of
// RELEASE_E2E_SERVER_URL/_DURABLE_USER_* blocked T3-REPO-1/local under strict
// behavior even though the world-backed LOCAL-1 path needs none of them —
// and strict preflight then cancelled every sibling cell. The requirement now
// lives inside the legacy path only.
test("T3-REPO-1 declares no scenario-level requiredEnv (world-backed strict path must plan clean)", () => {
  assert.deepEqual([...t3Repo1.requiredEnv], []);
});

test("T3-REPO-1 legacy path self-reports blocked when the durable-server env is absent", async (t) => {
  for (const name of [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ]) {
    const previous = process.env[name];
    delete process.env[name];
    t.after(() => {
      if (previous !== undefined) {
        process.env[name] = previous;
      }
    });
  }
  await assert.rejects(
    () => (t3Repo1 as { run: (ctx: ScenarioRunContext) => Promise<void> }).run(diagnosticCtx()),
    (error: unknown) => {
      assert.ok(error instanceof ScenarioBlockedError);
      assert.match(error.message, /RELEASE_E2E_SERVER_URL/);
      return true;
    },
  );
});
