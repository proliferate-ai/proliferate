import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { SCENARIOS } from "../scenarios/registry.js";
import { buildPlannedCells } from "./plan.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-e2e.yml"), "utf8");

function stagingJob(): string {
  const start = workflow.indexOf("  release-e2e-staging:");
  const end = workflow.indexOf("\n  # ---------------------------------------------------------------------------", start);
  assert.ok(start >= 0 && end > start, "release-e2e.yml must retain the staging job boundary");
  return workflow.slice(start, end);
}

test("staging workflow remains provisional and delegates compatibility to --lane staging", () => {
  const job = stagingJob();
  assert.match(job, /name: tier-3 staging lane \(provisional\)/);
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /LANE: staging/);
  assert.match(job, /SCENARIOS: \$\{\{ github\.event\.inputs\.scenarios \|\| 'all' \}\}/);
  assert.match(job, /make release-e2e LANE="\$LANE"/);
  assert.doesNotMatch(job, /RELEASE_E2E_LOCAL_RUNTIME_URL/);
  assert.doesNotMatch(job, /RELEASE_E2E_RELEASE_DESKTOP_VERSION/);
});

test("the staging workflow's real all-selector contains only Tier-3 sandbox cells", async () => {
  const cells = await buildPlannedCells(SCENARIOS, {
    targetLane: "staging",
    desktop: "web",
    agents: ["claude"],
  });
  assert.ok(cells.length > 0);
  assert.ok(cells.every((cell) => cell.runtime_lane === "sandbox"));
  assert.ok(cells.every((cell) => cell.scenario_id.startsWith("T3-")));
  assert.ok(cells.some((cell) => cell.scenario_id === "T3-PROV-2"));
  assert.ok(cells.every((cell) => !cell.scenario_id.startsWith("T4-")));
});
