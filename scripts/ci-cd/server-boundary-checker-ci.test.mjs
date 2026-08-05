import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

function workflowStep(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} workflow step`);
  const nextStep = workflow.indexOf("\n      - ", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? workflow.length : nextStep);
}

test("repo-shape runs focused server boundary tests before enforcing the boundary", () => {
  const testStep = workflowStep("Test server boundary checker");
  const checkStep = workflowStep("Check server layer boundaries");

  assert.match(testStep, /uv run --python 3\.12 --with pytest==9\.1\.1/);
  assert.match(
    testStep,
    /pytest --noconftest [\s\S]*server\/tests\/unit\/test_server_boundary_checker\.py/,
  );
  assert.match(checkStep, /python3 scripts\/check_server_boundaries\.py/);
  assert.ok(workflow.indexOf(testStep) < workflow.indexOf(checkStep));
});

test("the repo-shape workflow remains unfiltered for pull requests", () => {
  const triggerBlock = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("permissions:\n"));
  assert.match(triggerBlock, /\n  pull_request:\n  workflow_dispatch:\n/);
});
