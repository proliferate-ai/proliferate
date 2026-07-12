import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");

function workflow(name) {
  return readFileSync(path.join(workflowsDir, name), "utf8");
}

function triggerBlock(source) {
  const match = source.match(
    /\non:\n[\s\S]*?(?=\n(?:permissions|defaults|env|concurrency|jobs):\n)/,
  );
  assert.ok(match, "workflow is missing a bounded on block");
  return match[0];
}

test("all required merge gates run on merge-group integration commits", () => {
  for (const name of ["ci.yml", "intent-tests.yml", "server-ci.yml", "self-host-smoke.yml"]) {
    assert.match(triggerBlock(workflow(name)), /\n  merge_group:/, `${name} must run on merge_group`);
  }
});

test("direct main pushes cannot bypass Tier 1 or Tier 2", () => {
  for (const name of ["ci.yml", "intent-tests.yml", "server-ci.yml", "self-host-smoke.yml"]) {
    const triggers = triggerBlock(workflow(name));
    assert.match(triggers, /\n  push:\n    branches: \[main\]/, `${name} must run on main push`);
  }
});

test("server Tier 1 always reports on pull requests instead of disappearing behind path filters", () => {
  const source = workflow("server-ci.yml");
  const triggers = triggerBlock(workflow("server-ci.yml"));
  assert.match(triggers, /\n  pull_request:\n/);
  assert.doesNotMatch(triggers, /\n  pull_request:\n(?:    .*\n)*?    paths:/);
  assert.match(source, /name: Server lint/);
  assert.match(source, /name: Server tests/);
  assert.match(source, /-m "not cloud_e2e" -p tests\.strict_ci_plugin/);
});

test("the core CI semantically lints workflows and enforces deterministic package runners", () => {
  const source = workflow("ci.yml");
  for (const command of [
    "go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12",
    "pnpm -C tests/release typecheck",
    "pnpm -C tests/release test",
    "- name: Test SDK",
    "- name: Test sdk-react",
    "pnpm --filter @anyharness/tests test:deterministic",
    "pnpm --filter @proliferate/web test",
    "pnpm --filter @proliferate/ui test",
    "pnpm --filter @proliferate/product-surfaces test",
  ]) {
    assert.ok(source.includes(command), `ci.yml must enforce: ${command}`);
  }
});

test("Tier 2 typechecks before executing its fail-closed Playwright suite", () => {
  const source = workflow("intent-tests.yml");
  const typecheck = source.indexOf("pnpm -C tests/intent exec tsc --noEmit");
  const execute = source.indexOf("pnpm -C tests/intent test");
  assert.ok(typecheck > 0 && execute > typecheck);
});
