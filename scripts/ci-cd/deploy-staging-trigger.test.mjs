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

function triggerBlock(source, name) {
  const start = source.indexOf("\non:");
  assert.notEqual(start, -1, `${name}: could not locate the on: trigger block`);
  const end = source.indexOf("\npermissions:", start);
  const block = source.slice(start, end === -1 ? undefined : end);
  assert.notEqual(block.trim(), "", `${name}: trigger block is empty`);
  return block;
}

// A workflow starts from main when it chains off another workflow's run or
// filters on the main branch. `branches:` accepts a flow sequence
// (`[main]`) and a block sequence (`\n  - main`); both forms must be caught.
const MAIN_BRANCH_FILTER = /branches:\s*(?:\[[^\]]*\bmain\b[^\]]*\]|(?:\r?\n\s*-\s*["']?main["']?))/;
// `Production` and `production` are the same GitHub Environment reference as
// far as a reviewer scanning for prod reach is concerned, and the two deleted
// coordinators both used the lowercase spelling.
const PRODUCTION_ENVIRONMENT = /environment:\s*["']?[Pp]roduction["']?/;

test("staging runs only when an operator dispatches it", () => {
  const triggers = triggerBlock(workflow, "deploy-staging.yml");

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
    const triggers = triggerBlock(source, name);
    const startsOnMain =
      /workflow_run:/.test(triggers) || MAIN_BRANCH_FILTER.test(triggers);
    const deploys = /uses: \.\/\.github\/workflows\/_deploy-/.test(source);
    if (startsOnMain && deploys) {
      automatic.push(name);
    }
  }

  assert.deepEqual(automatic, []);
});

test("release.yml is the only entrypoint into a production deploy lane", () => {
  const coordinators = workflowNames().filter((name) =>
    PRODUCTION_ENVIRONMENT.test(read(name)),
  );

  assert.deepEqual(coordinators, ["release.yml"]);
});

test("staging never targets the production environment", () => {
  assert.doesNotMatch(workflow, PRODUCTION_ENVIRONMENT);
  assert.match(workflow, /environment: staging/);
});

test("a deploy-only run refuses to resolve an empty surface set", () => {
  // A skip_build promote whose ref is already the previous checkpoint detects
  // no changes. Without this guard every deploy job's `selected_surfaces != ''`
  // condition is false and the run reports success having deployed nothing.
  const release = read("release.yml");
  const guard = release.slice(
    release.indexOf("- name: Require an explicit surface set for a deploy-only run"),
    release.indexOf("- name: Prepare product and artifact versions"),
  );

  assert.notEqual(guard, "", "release.yml must guard a deploy-only run with no surfaces");
  assert.match(guard, /steps\.meta\.outputs\.skip_build == 'true'/);
  assert.match(guard, /steps\.detect\.outputs\.selected_surfaces == ''/);
  assert.match(guard, /::error::/);
  assert.match(guard, /exit 1/);
});
