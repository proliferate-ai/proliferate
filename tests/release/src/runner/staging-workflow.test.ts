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

function localFunctionalJob(): string {
  const start = workflow.indexOf("  release-e2e-local-functional:");
  const end = workflow.indexOf("\n  # ---------------------------------------------------------------------------", start);
  assert.ok(start >= 0 && end > start, "release-e2e.yml must retain the local-functional job boundary");
  return workflow.slice(start, end);
}

test("the staging battery runs in observe mode: visible verdicts, nightly cron, durable session state", () => {
  const job = stagingJob();
  assert.match(job, /name: staging battery \(observe mode\)/);
  // Observe mode (delivery-spec-e2e-observable): red is visible and blocks
  // nothing by construction — never masked by continue-on-error.
  assert.doesNotMatch(job, /continue-on-error: true/);
  // The nightly cron exists at the workflow level and only this job keys on it.
  assert.match(workflow, /^  schedule:\n(?:    #.*\n)*    - cron: "0 8 \* \* \*"/m);
  assert.equal((workflow.match(/github\.event_name == 'schedule'/g) ?? []).length, 1);
  // Rotation write-back: the state file is restored before and saved after the battery.
  assert.match(job, /actions\/cache\/restore@[0-9a-f]{40}/);
  assert.match(job, /actions\/cache\/save@[0-9a-f]{40}/);
  assert.match(job, /RELEASE_E2E_STAGING_SESSION_STATE: \$\{\{ github\.workspace \}\}\/\.release-e2e\/staging-session\.json/);
  // The digest always runs and never gates.
  assert.match(job, /name: Morning digest\n\s+if: always\(\)/);
  assert.match(job, /battery-digest\.mjs/);
  // The provisioned-but-previously-unmapped vars now reach the runner.
  for (const name of ["RELEASE_E2E_WEB_URL", "RELEASE_E2E_GITHUB_TEST_REPO", "RELEASE_E2E_INTEGRATION_API_KEY"]) {
    assert.match(job, new RegExp(`${name}: \\$\\{\\{ (?:vars|secrets)\\.`));
  }
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
  // The battery family is admitted by the same gate, unchanged.
  for (const id of [
    "T3-BATT-AUTH-1",
    "T3-BATT-WEB-1",
    "T3-BATT-GH-1",
    "T3-BATT-BILL-1",
    "T3-BATT-WORKER-1",
    "T3-BATT-INT-1",
    "T3-BATT-RUN-1",
  ]) {
    assert.ok(cells.some((cell) => cell.cell_id === `${id}/sandbox`), `${id} must plan on the staging lane`);
  }
});

test("local-functional maps every BYOK env var from the provisioned _API_KEY secret", () => {
  const job = localFunctionalJob();
  for (const name of [
    "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
    "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY",
    "RELEASE_E2E_BYOK_OPENAI_API_KEY",
    "RELEASE_E2E_BYOK_XAI_API_KEY",
  ]) {
    assert.match(job, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
  assert.doesNotMatch(job, /secrets\.RELEASE_E2E_BYOK_(?:ANTHROPIC_[AB]|OPENAI|XAI)\s*\}\}/);
});
