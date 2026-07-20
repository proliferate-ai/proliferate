import assert from "node:assert/strict";
import { test } from "node:test";

import { qualificationWorldScenarioIds, selectScenarios } from "./registry.js";

const LOCAL_EXECUTABLE_SCENARIOS = [
  "LOCAL-WORLD-SMOKE-1",
  "T3-WT-1",
  "T3-REPO-1",
  "T3-CHAT-1",
  "T3-AUTHROUTE-1",
  "T3-CFG-1",
  "T3-SESSION-1",
  "T3-INT-1",
] as const;

test("the Local qualification world inventory selects every and only executable scenarios", () => {
  assert.deepEqual(qualificationWorldScenarioIds("local"), LOCAL_EXECUTABLE_SCENARIOS);
  assert.deepEqual(
    selectScenarios("all", "local").map((scenario) => scenario.id),
    LOCAL_EXECUTABLE_SCENARIOS,
  );
  for (const id of LOCAL_EXECUTABLE_SCENARIOS) {
    assert.deepEqual(selectScenarios([id], "local").map((scenario) => scenario.id), [id]);
  }
});

test("the Local qualification world rejects manifest-known deferred and non-Local scenarios", () => {
  assert.throws(() => selectScenarios(["T3-AUTH-1"], "local"), /Unknown scenario/);
  assert.throws(() => selectScenarios(["T3-MOBILITY-1"], "local"), /Unknown scenario/);
  assert.throws(() => selectScenarios(["T3-SH-2"], "local"), /not executable in qualification world/);
});
