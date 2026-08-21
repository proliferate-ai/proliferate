import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDir = path.join(repoRoot, ".github/workflows");
const workflow = readFileSync(path.join(workflowDir, "deploy-staging.yml"), "utf8");

function read(name) {
  return readFileSync(path.join(workflowDir, name), "utf8");
}

function workflowNames() {
  return readdirSync(workflowDir).filter((name) => name.endsWith(".yml"));
}

function triggerBlock(source) {
  const start = source.indexOf("\non:");
  const end = source.indexOf("\npermissions:", start);
  return source.slice(start, end === -1 ? undefined : end);
}

test("staging runs only when an operator dispatches it", () => {
  const triggers = triggerBlock(workflow);

  assert.match(triggers, /^on:\n  workflow_dispatch:$/m);
  assert.doesNotMatch(triggers, /workflow_run:/);
  assert.doesNotMatch(triggers, /\bpush:/);
  assert.doesNotMatch(triggers, /\bschedule:/);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
});

test("merging to main deploys nothing", () => {
  const automatic = [];
  for (const name of workflowNames()) {
    const source = read(name);
    const triggers = triggerBlock(source);
    const startsOnMain =
      /workflow_run:/.test(triggers) || /branches:\s*\[\s*main\s*\]/.test(triggers);
    const deploys = /uses: \.\/\.github\/workflows\/_deploy-/.test(source);
    if (startsOnMain && deploys) {
      automatic.push(name);
    }
  }

  assert.deepEqual(automatic, []);
});

test("release.yml is the only entrypoint into a production deploy lane", () => {
  const coordinators = workflowNames().filter((name) =>
    /environment: Production/.test(read(name)),
  );

  assert.deepEqual(coordinators, ["release.yml"]);
});

test("staging never targets the production environment", () => {
  assert.doesNotMatch(workflow, /environment: Production/);
  assert.match(workflow, /environment: staging/);
});
