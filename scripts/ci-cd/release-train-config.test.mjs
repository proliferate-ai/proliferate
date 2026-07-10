import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards the release train's staging-only default (ci-cd.md: production is a
// manual promotion from a staging-tested SHA). The train must never reach a
// production lane or publish the desktop stable updater feed unless the run
// explicitly opted in via the promote_production dispatch input — and the
// scheduled nightly run has no inputs, so it can never opt in.
//
// These are structural assertions on the workflow YAML text, not a YAML
// object model: what matters is that every prod job's `if:` carries the
// promote_production guard verbatim and the updater publish is bound to the
// same output, which survives refactors that keep the contract and fails
// loudly on any edit that drops a guard.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const trainPath = path.join(repoRoot, ".github", "workflows", "nightly-release-train.yml");
const train = readFileSync(trainPath, "utf8");

const PROD_JOBS = [
  "deploy-e2b-prod",
  "deploy-server-prod",
  "deploy-workers-prod",
  "deploy-web-prod",
  "deploy-mobile-prod",
];

function jobBlock(source, jobId) {
  const start = source.indexOf(`\n  ${jobId}:`);
  assert.notEqual(start, -1, `job ${jobId} exists in nightly-release-train.yml`);
  // A job block ends at the next top-level (two-space-indented) job key.
  const rest = source.slice(start + 1);
  const next = rest.slice(`  ${jobId}:`.length).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, `  ${jobId}:`.length + next);
}

test("promote_production dispatch input exists and defaults to false", () => {
  assert.match(train, /promote_production:/);
  const inputBlock = jobBlock(train, "prepare"); // sanity: prepare exists
  assert.ok(inputBlock.length > 0);
  const inputSection = train.slice(train.indexOf("promote_production:"), train.indexOf("permissions:"));
  assert.match(inputSection, /default: false/, "promote_production must default to false");
});

test("prepare resolves promote_production with a scheduled-run-safe fallback", () => {
  assert.match(
    train,
    /PROMOTE_PRODUCTION: \$\{\{ github\.event\.inputs\.promote_production \|\| 'false' \}\}/,
    "scheduled runs (no inputs) must resolve promote_production to false",
  );
  assert.match(train, /echo "promote_production=\$PROMOTE_PRODUCTION"/);
});

for (const jobId of PROD_JOBS) {
  test(`${jobId} is gated on promote_production`, () => {
    const block = jobBlock(train, jobId);
    assert.match(
      block,
      /needs\.prepare\.outputs\.promote_production == 'true'/,
      `${jobId} must not run without the explicit promote_production opt-in`,
    );
  });
}

test("desktop stable updater publish is gated on promote_production", () => {
  const block = jobBlock(train, "release-desktop");
  assert.match(
    block,
    /publish_updater: \$\{\{ needs\.prepare\.outputs\.promote_production == 'true' \}\}/,
    "the stable updater feed must only publish when production promotion was requested",
  );
});
