import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for the Tier 3/4 workflow result policy. Signal runs may
// inventory blocked/expected-fail implementation gaps, but an actual runner
// failure must stay red. A dispatch explicitly designated `release` must reach
// the runner's strict manifest policy, and evidence/cleanup must still execute
// after a red runner.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releasePath = path.join(repoRoot, ".github", "workflows", "release-e2e.yml");
const selfHostPath = path.join(repoRoot, ".github", "workflows", "release-e2e-selfhost.yml");
const release = readFileSync(releasePath, "utf8");
const selfHost = readFileSync(selfHostPath, "utf8");

function jobBlock(source, jobId) {
  const start = source.indexOf(`\n  ${jobId}:`);
  assert.notEqual(start, -1, `job ${jobId} exists`);
  const rest = source.slice(start + 1);
  const next = rest.slice(`  ${jobId}:`.length).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, `  ${jobId}:`.length + next);
}

test("manual release E2E defaults strict while scheduled runs fall back to signal", () => {
  const inputSection = release.slice(release.indexOf("      policy:"), release.indexOf("  schedule:"));
  assert.match(inputSection, /default: release/);
  assert.match(inputSection, /- signal/);
  assert.match(inputSection, /- release/);
  assert.match(release, /github\.event\.inputs\.policy \|\| 'signal'/);
});

for (const jobId of ["release-e2e-local", "release-e2e-staging"]) {
  test(`${jobId} preserves runner failure and forwards the selected policy`, () => {
    const block = jobBlock(release, jobId);
    assert.doesNotMatch(block, /\n    continue-on-error:/);
    assert.match(block, /RELEASE_POLICY: \$\{\{ github\.event\.inputs\.policy \|\| 'signal' \}\}/);
  });

  test(`${jobId} uploads evidence after failure`, () => {
    const block = jobBlock(release, jobId);
    assert.match(block, /name: Upload failure reports[\s\S]*?if: always\(\)/);
    assert.match(block, /path: tests\/release\/\.output\/[\s\S]*?include-hidden-files: true/);
  });
}

test("missing gateway credential never green-skips the whole local suite", () => {
  const block = jobBlock(release, "release-e2e-local");
  const missingKeyBranch = block.slice(
    block.indexOf('if [ -z "$GATEWAY_TEST_KEY" ]'),
    block.indexOf('if [ -z "$DURABLE_USER_EMAIL" ]'),
  );
  assert.match(missingKeyBranch, /if \[ "\$POLICY" = "release" \]/);
  assert.match(missingKeyBranch, /strict runner will record the affected required rows as blocked and fail closed/);
  assert.doesNotMatch(missingKeyBranch, /enabled=false/);
});

test("self-host Tier 3/4 jobs preserve genuine runner failures", () => {
  for (const jobId of ["artifact-chain", "provisioning"]) {
    assert.doesNotMatch(jobBlock(selfHost, jobId), /\n    continue-on-error:/);
  }
});

test("self-host cleanup/evidence remains unconditional", () => {
  const block = jobBlock(selfHost, "provisioning");
  assert.match(block, /name: Upload failure reports[\s\S]*?if: always\(\)/);
  assert.match(block, /path: tests\/release\/\.output\/[\s\S]*?include-hidden-files: true/);
});

test("self-host artifact workflow is an honest nightly/manual published diagnostic", () => {
  assert.doesNotMatch(selfHost, /\n  workflow_call:/);
  assert.match(selfHost, /release_desktop_version:/);
  assert.match(selfHost, /release_date:/);
  assert.doesNotMatch(selfHost, /release_sha:/);
  assert.match(selfHost, /name: T4-SH-2 published desktop artifact diagnostic/);
});

test("published diagnostic resolves stable metadata independently of the repo VERSION", () => {
  const block = jobBlock(selfHost, "artifact-chain");
  assert.match(block, /STABLE_MANIFEST_URL: https:\/\/downloads\.proliferate\.com\/desktop\/stable\/latest\.json/);
  assert.match(block, /stable_version=/);
  assert.match(block, /tag_date=/);
  assert.match(block, /for-each-ref --format='\%\(creatordate:iso-strict\)'/);
  assert.doesNotMatch(block, /show -s --format=%cI/);
  assert.match(block, /RELEASE_E2E_RELEASE_DATE: \$\{\{ steps\.release\.outputs\.release_date \}\}/);
  assert.match(block, /RELEASE_E2E_RELEASE_DESKTOP_VERSION: \$\{\{ steps\.release\.outputs\.version \}\}/);
  assert.doesNotMatch(block, /repo VERSION|cat VERSION/);
});
