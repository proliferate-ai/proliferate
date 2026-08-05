import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/deploy-staging.yml"),
  "utf8",
);
const repository = "proliferate-ai/proliferate";

function automaticGroup({ event, conclusion, headRepository, headBranch }) {
  return `deploy-staging-${event}-${conclusion}-${headRepository}-${headBranch}`;
}

function isTrustedAutomaticRun({ event, conclusion, headRepository, headBranch }) {
  return (
    event === "push" &&
    conclusion === "success" &&
    headRepository === repository &&
    headBranch === "main"
  );
}

test("staging queues workflow-run events from main only", () => {
  assert.match(
    workflow,
    /^on:\n  workflow_run:\n    workflows: \["CI"\]\n    types: \[completed\]\n    branches: \[main\]$/m,
  );
  assert.match(
    workflow,
    /format\('push-success-\{0\}-main', github\.repository\)/,
  );
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
});

test("a fork pull request named main cannot enter or displace the trusted queue", () => {
  const trusted = {
    event: "push",
    conclusion: "success",
    headRepository: repository,
    headBranch: "main",
  };
  const forkPullRequest = {
    event: "pull_request",
    conclusion: "success",
    headRepository: "contributor/proliferate",
    headBranch: "main",
  };

  assert.equal(isTrustedAutomaticRun(trusted), true);
  assert.equal(isTrustedAutomaticRun(forkPullRequest), false);
  assert.notEqual(automaticGroup(forkPullRequest), automaticGroup(trusted));
});
