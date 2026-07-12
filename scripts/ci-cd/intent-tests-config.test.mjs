import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

const workflow = read(".github/workflows/intent-tests.yml");
const makefile = read("Makefile");
const mainConfig = read("tests/intent/playwright.config.ts");
const billingConfig = read("tests/intent/playwright.billing.config.ts");
const surfacesConfig = read("tests/intent/playwright.surfaces.config.ts");
const billingSetup = read("tests/intent/stack/billing-global-setup.ts");
const boot = read("tests/intent/stack/boot.ts");
const reporter = read("tests/intent/stack/strict-reporter.ts");
const capabilityContract = read("tests/intent/specs/capability-contract.spec.ts");
const provisioningGate = read("tests/intent/specs/cloud-provisioning-gating.spec.ts");
const agentPolicy = read("tests/intent/specs/agent-policy.spec.ts");
const seed = read("tests/intent/stack/seed.ts");
const surfaceFixture = read("tests/intent/stack/surface-fixture.ts");
const billingFixtures = read("tests/intent/specs/billing/_fixtures.ts");
const billingSeed = read("tests/intent/stack/billing-seed.ts");

function jobBlock(jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  assert.notEqual(start, -1, `job ${jobId} exists`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(`  ${jobId}:`.length).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, `  ${jobId}:`.length + next);
}

test("Tier-2 jobs preserve failures and run on the merge queue", () => {
  assert.match(workflow, /\n  merge_group:/);
  for (const jobId of ["intent-tests", "intent-surfaces", "intent-billing"]) {
    const block = jobBlock(jobId);
    assert.doesNotMatch(block, /\n    continue-on-error:/);
    assert.doesNotMatch(block, /provisional/i);
  }
});

test("the main job builds and requires the AnyHarness HTTP seam", () => {
  const block = jobBlock("intent-tests");
  assert.match(block, /cargo build -p anyharness --bin anyharness/);
  assert.match(block, /TIER2_INTENT_REQUIRE_RUNTIME: "1"/);
  assert.doesNotMatch(block, /TIER2_INTENT_SKIP_RUNTIME: "1"/);
  assert.match(boot, /waiting for required AnyHarness runtime to become ready/);
  assert.match(boot, /allowNotFound: false/);
  assert.doesNotMatch(boot, /\.proliferate-local[\s\S]*runtime-bin[\s\S]*anyharness/);
  assert.match(boot, /must belong to the candidate checkout/);
  assert.match(boot, /const runtimeRequired = isRuntimeRequired\(frontendMode, runtimeSkipped\)/);
});

test("billing runs only in trusted secret contexts and then fails closed", () => {
  const block = jobBlock("intent-billing");
  assert.match(block, /github\.event_name != 'pull_request'/);
  assert.match(block, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(block, /github\.actor != 'dependabot\[bot\]'/);
  assert.match(block, /STRIPE_TEST_SECRET_KEY: \$\{\{ secrets\.STRIPE_TEST_SECRET_KEY \}\}/);
  assert.match(block, /run: make test-intent-billing/);
  assert.match(makefile, /test-intent-billing:[\s\S]*?env:exec --allow STRIPE_TEST_SECRET_KEY/);
  assert.match(makefile, /sk_test_\*\) server_stripe_secret_key=/);
  assert.match(makefile, /server_e2b_api_key="\$\$release_e2b_api_key"/);
  assert.match(makefile, /unset STRIPE_TEST_SECRET_KEY RELEASE_E2E_E2B_API_KEY/);
  assert.match(makefile, /STRIPE_SECRET_KEY="\$\$server_stripe_secret_key" E2B_API_KEY="\$\$server_e2b_api_key" \.venv\/bin\/uvicorn/);
  assert.match(billingSetup, /The required suite cannot be skipped/);
  assert.match(billingSetup, /Refusing the configured non-test credential/);
  assert.doesNotMatch(billingSetup, /TIER2_BILLING_SKIP/);
});

test("every Playwright config forbids focused CI tests and installs the strict reporter", () => {
  for (const config of [mainConfig, billingConfig, surfacesConfig]) {
    assert.match(config, /forbidOnly: Boolean\(process\.env\.CI\)/);
    assert.match(config, /\.\/stack\/strict-reporter\.ts/);
  }
});

test("dual-host readiness is an isolated required strict gate without a parity overclaim", () => {
  assert.match(mainConfig, /"\*\*\/surfaces\/\*\*"/);
  assert.match(surfacesConfig, /shared-control-plane checks/);
  assert.match(surfacesConfig, /do not claim chat\/settings\/billing parity/);
  assert.equal(jobBlock("intent-surfaces").includes("run: pnpm -C tests/intent run test:surfaces"), true);
  assert.match(surfacesConfig, /retries: 0/);
  assert.match(workflow, /Verify exact tier-2 execution inventory/);
  assert.match(workflow, /pnpm -C tests\/intent run test:inventory/);
});

test("the strict reporter rejects final skips, expected failures, unexpected passes, and flaky retries", () => {
  assert.match(reporter, /outcome\.expectedStatus !== "passed"/);
  assert.match(reporter, /outcome\.finalStatus !== "passed"/);
  assert.match(reporter, /result\.status === "failed"/);
  assert.match(reporter, /unexpected pass \(expected/);
  assert.match(reporter, /flaky \(passed only after a failed attempt\)/);
  assert.match(reporter, /return \{ status: "failed" \}/);
  assert.match(workflow, /pnpm -C tests\/intent run test:reporter/);
});

test("collected Tier-2 specs contain no skip or expected-fail escape", () => {
  const specsRoot = path.join(repoRoot, "tests", "intent", "specs");
  const files = readdirSync(specsRoot, { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".ts"));
  for (const relative of files) {
    const source = readFileSync(path.join(specsRoot, relative), "utf8");
    assert.doesNotMatch(source, /test\.(?:skip|fixme|fail)\s*\(/, relative);
  }
});

test("nested Tier-2 stacks derive profiles from the run profile", () => {
  for (const source of [capabilityContract, provisioningGate, agentPolicy]) {
    assert.match(source, /process\.env\.TIER2_INTENT_PROFILE/);
    assert.doesNotMatch(source, /profile:\s*["']t2[^"']+["']/);
    assert.match(source, /test\.setTimeout\(600_000\)/);
  }
});

test("single-org surface and billing fixtures remain password-only with zero OAuth rows", () => {
  for (const source of [seed, surfaceFixture, billingFixtures, billingSeed]) {
    assert.doesNotMatch(source, /INSERT INTO oauth_account/i);
    assert.doesNotMatch(source, /ensureProductReady/);
  }
  assert.match(seed, /SELECT count\(\*\)::text AS count FROM oauth_account WHERE user_id = \$1/);
  assert.match(surfaceFixture, /await assertNoOauthAccountRows\(viewer\.body\.id\)/);
  assert.match(billingFixtures, /await assertNoOauthAccountRows\(me\.id\)/);
});
