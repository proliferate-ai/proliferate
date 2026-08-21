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
// coordinators both used the lowercase spelling. The spellings are NOT
// interchangeable at deploy time, though: the string is passed through to
// `DEPLOY_ENVIRONMENT` and interpolated into SSM parameter paths. See the
// deploy-environment casing test below.
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

test("a dry run walks the graph without any externally visible effect", () => {
  // dry_run is the standing wiring proof: every job must still be reachable, and
  // every step that writes to main, to a tag, to a cloud provider, or to a
  // GitHub Release must be suppressed.
  const release = read("release.yml");

  const section = (from, to) => {
    const start = release.indexOf(from);
    assert.notEqual(start, -1, `release.yml is missing ${from}`);
    const end = to ? release.indexOf(to, start + from.length) : -1;
    return release.slice(start, end === -1 ? undefined : end);
  };

  // Nothing is pushed to main and no tag is minted.
  const commit = section("- name: Commit version bumps", "- name: Create release tags");
  assert.match(commit, /if \[\[ "\$SKIP_BUILD" == "true" \|\| "\$DRY_RUN" == "true" \]\]; then/);
  const earlyReturn = commit.indexOf("exit 0");
  const pushToMain = commit.indexOf(
    'push "https://x-access-token:${RELEASE_PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:main',
  );
  assert.notEqual(earlyReturn, -1, "the commit step must keep its dry-run early return");
  assert.notEqual(pushToMain, -1, "the commit step must push to main with RELEASE_PUSH_TOKEN");
  assert.ok(earlyReturn < pushToMain, "the dry-run early return must precede the push to main");
  for (const step of ["- name: Verify version tags are free", "- name: Create release tags"]) {
    assert.match(
      section(step, "\n      - name:"),
      /steps\.meta\.outputs\.dry_run != 'true'/,
      `${step} must be suppressed on a dry run`,
    );
  }

  // No artifact release build runs.
  for (const job of ["  release-runtime:", "  release-server:", "  release-desktop:"]) {
    assert.match(
      section(job, "    uses:"),
      /needs\.prepare\.outputs\.dry_run != 'true'/,
      `${job.trim()} must be skipped on a dry run`,
    );
  }

  // Every deploy lane is still called, but with the enabled no-op switch off, so
  // the call wiring is exercised and nothing reaches AWS or Vercel.
  const deployJobs = [...release.matchAll(/^  (deploy-[a-z-]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(deployJobs, ["deploy-server-prod", "deploy-litellm-prod", "deploy-web-prod"]);
  for (const job of deployJobs) {
    const body = section(`  ${job}:`, "    secrets: inherit");
    assert.match(body, /uses: \.\/\.github\/workflows\/_deploy-/, `${job} must still call its lane`);
    assert.match(
      body,
      /enabled: \$\{\{ needs\.prepare\.outputs\.[a-z]+ == 'true' && needs\.prepare\.outputs\.dry_run != 'true' \}\}/,
      `${job} must pass enabled: false on a dry run`,
    );
  }

  // The product release page renders but is never created or updated.
  const publish = section("  publish-product-release:", "  summary:");
  assert.match(publish, /--dry-run "\$\{\{ needs\.prepare\.outputs\.dry_run \}\}"/);
  assert.match(publish, /needs\.prepare\.outputs\.dry_run == 'true' \|\|/);

  // Both summaries say so out loud.
  assert.match(section("- name: Summarize plan", "  # \u2500\u2500 Release builds"), /Dry run/);
  assert.match(section("- name: Summarize results"), /DRY RUN\./);
});

test("deploy environment inputs use the exact casing the AWS resource paths use", () => {
  // GitHub matches environment names case-insensitively, so `Production` binds
  // to the same environment as `production` and nothing fails at bind time.
  // But the same string becomes `DEPLOY_ENVIRONMENT`, which is interpolated
  // raw into SSM parameter paths (`/proliferate/${DEPLOY_ENVIRONMENT}/litellm/...`
  // in _deploy-litellm.yml, `/proliferate/${DEPLOY_ENVIRONMENT}/support/...` in
  // _deploy-server.yml) and into the CloudWatch log group name. Those resources
  // exist only under the lowercase spelling, and the deploy role's IAM policy is
  // scoped to it, so a capitalized input fails with AccessDeniedException at
  // deploy time. Release run 32450223908 lost its LiteLLM deploy to exactly this.
  //
  // The canonical spelling is the environment key in the hosted contract, which
  // is the same token the AWS resources are named after.
  const contract = JSON.parse(
    readFileSync(path.join(repoRoot, "server/deploy/hosted-redis-contract.json"), "utf8"),
  );
  const canonical = new Set(Object.keys(contract.environments));
  assert.ok(canonical.size > 0, "the hosted contract must declare environments");

  for (const name of ["release.yml", "deploy-staging.yml"]) {
    const source = read(name);
    const passed = [...source.matchAll(/^      environment: (\S+)$/gm)].map((match) => match[1]);
    assert.ok(passed.length > 0, `${name}: expected at least one environment input`);
    for (const value of passed) {
      assert.ok(
        canonical.has(value),
        `${name}: environment input '${value}' is not a hosted contract environment key ` +
          `(${[...canonical].join(", ")}). The input is interpolated into SSM paths, so the ` +
          `casing must match the AWS resources exactly.`,
      );
    }
  }
});
