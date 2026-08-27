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
  // End at the NEXT top-level key, whatever it is — slicing to a hard-coded
  // `permissions:` let a workflow without one leak job keys into the block.
  const rest = source.slice(start + 1);
  const next = rest.slice("on:".length).search(/\n[A-Za-z_-]+:/);
  const block = next === -1 ? rest : rest.slice(0, next + "on:".length);
  assert.notEqual(block.trim(), "", `${name}: trigger block is empty`);
  return block;
}

// Every event name a workflow is triggered by, across all three YAML
// spellings: `on: push` (scalar), `on: [push, workflow_dispatch]` (flow
// sequence), and the block map. Filters (branches/tags/paths) are irrelevant
// here on purpose: a bare `push:`, `push: tags:`, or `branches: ['**']` is
// exactly the porous spelling the previous filter-matching scan waved through.
function triggerEvents(source, name) {
  const scalar = source.match(/^on:\s*([a-z_]+)\s*$/m);
  if (scalar) return [scalar[1]];
  const flow = source.match(/^on:\s*\[([^\]]*)\]/m);
  if (flow) {
    return flow[1]
      .split(",")
      .map((entry) => entry.trim().replace(/["']/g, ""))
      .filter(Boolean);
  }
  const block = triggerBlock(source, name);
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1]);
}

// Events that fire without a human pressing anything on this repository.
const AUTOMATIC_EVENTS = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "workflow_run",
  "merge_group",
  "repository_dispatch",
]);
// `Production` and `production` are the same GitHub Environment reference as
// far as a reviewer scanning for prod reach is concerned, and the two deleted
// coordinators both used the lowercase spelling. The spellings are NOT
// interchangeable at deploy time, though: the string is passed through to
// `DEPLOY_ENVIRONMENT` and interpolated into SSM parameter paths. See the
// deploy-environment casing test below.
const PRODUCTION_ENVIRONMENT = /environment:\s*["']?[Pp]roduction["']?/;

test("staging deploys from green main and from an operator", () => {
  const triggers = triggerBlock(workflow, "deploy-staging.yml");

  // The one automated transition: either rollup's completion on main (the
  // plan deploys only when both are green for the head; the earlier event
  // exits neutrally, and a re-run-to-green re-fires the trigger).
  assert.match(
    triggers,
    /workflow_run:\n(?:\s*#[^\n]*\n)*    workflows: \["CI", "Server CI"\]\n    types: \[completed\]\n    branches: \[main\]/,
  );

  // The run title names what is being deployed — every workflow_run row
  // otherwise displays the default-branch head while deploying another SHA.
  assert.match(
    workflow,
    /run-name: "Deploy Staging · \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.event\.inputs\.ref \|\| github\.sha \}\} · \$\{\{ github\.event_name \}\}"/,
  );
  // Operators keep dispatch for reruns, forced surfaces, and dry runs.
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\bpush:/);
  assert.doesNotMatch(triggers, /\bschedule:/);

  // Auto runs deploy only what CI proved ON THIS REPO'S MAIN: the plan job
  // refuses non-success conclusions AND anything that is not a push to main
  // from this repository (the workflow_run branch filter matches a fork PR's
  // head branch named `main`, which would otherwise auto-deploy fork code with
  // inherited secrets). The checkout pins the triggering run's exact head SHA.
  assert.match(
    workflow,
    /github\.event_name != 'workflow_run' \|\| \(github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.event == 'push' && github\.event\.workflow_run\.head_branch == 'main' && github\.event\.workflow_run\.head_repository\.full_name == github\.repository\)/,
  );
  // Non-deployable events (red CI, non-push triggers) never share the deploy
  // concurrency group, so they cannot cancel a pending real deploy.
  assert.match(
    workflow,
    /group: deploy-staging-\$\{\{ github\.repository \}\}-\$\{\{ \(github\.event_name == 'workflow_run' && \(github\.event\.workflow_run\.conclusion != 'success' \|\| github\.event\.workflow_run\.event != 'push'\)\) && github\.run_id \|\| 'main' \}\}/,
  );
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.inputs\.ref \|\| github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/,
  );

  // Latest-wins staggering: one running plus one pending, never cancel a
  // deploy mid-roll.
  assert.match(workflow, /^  cancel-in-progress: false$/m);

  // A staleness fallback deploys everything unless the operator chose surfaces.
  assert.match(
    workflow,
    /FORCE_SURFACES: \$\{\{ github\.event\.inputs\.force_surfaces \|\| \(steps\.head\.outputs\.base_mode == 'fallback' && 'all'\) \|\| '' \}\}/,
  );
});

test("deploy-staging is the only workflow that auto-deploys, and only release.yml deploys on a schedule", () => {
  // A workflow deploys if it reaches a `_deploy-` lane directly OR through any
  // chain of local reusable workflows — a non-`_deploy-` wrapper with
  // `workflow_call` must not launder its callers past this scan.
  const sources = new Map(workflowNames().map((name) => [name, read(name)]));
  const memo = new Map();
  const deploysTransitively = (name) => {
    if (memo.has(name)) return memo.get(name);
    memo.set(name, false); // cycle guard
    const source = sources.get(name);
    if (!source) return false;
    const uses = [...source.matchAll(/uses: \.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g)].map(
      (match) => match[1],
    );
    const result =
      uses.some((used) => used.startsWith("_deploy-")) ||
      uses.some((used) => deploysTransitively(used));
    memo.set(name, result);
    return result;
  };

  const automatic = [];
  const scheduled = [];
  for (const name of workflowNames()) {
    if (!deploysTransitively(name)) continue;
    const events = triggerEvents(sources.get(name), name);
    if (events.some((event) => AUTOMATIC_EVENTS.has(event))) automatic.push(name);
    if (events.includes("schedule")) scheduled.push(name);
  }

  // Staging is the sanctioned automatic transition. Production reaches a
  // deploy lane only through release.yml — its daily cron is the transitional
  // delivery path, pinned here until the retirement PR that makes promotion
  // deliberate (ruled 2026-08-26).
  assert.deepEqual(automatic, ["deploy-staging.yml"]);
  assert.deepEqual(scheduled, ["release.yml"]);
});

test("the plan resolves the deploy head against both rollups and guards regressions", () => {
  // Refuter findings on #2269: completion-order latest-wins could deploy
  // commits out of order (or cancel a newer commit's deploy in favor of an
  // older one's), and the 45-minute Server CI poll neither survived a
  // re-run-to-green nor a backed-up queue. The plan now advances to the
  // newest fully green first-parent main commit and refuses to move staging
  // backwards; the poll is gone in favor of completion events from both
  // rollups.
  assert.match(workflow, /workflows: \["CI", "Server CI"\]/);
  assert.doesNotMatch(workflow, /Wait for Server CI if present/);
  assert.doesNotMatch(workflow, /sleep 30/);
  assert.match(workflow, /rollup_status\(\)/);
  assert.match(workflow, /--workflow "\$wf"/);
  assert.match(workflow, /for wf in ci\.yml server-ci\.yml; do/);
  assert.match(workflow, /git rev-list --first-parent --max-count=\d+ origin\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$event_head" "\$candidate"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$base_sha" "\$deploy_head"/);
  assert.match(workflow, /proceed=false/);

  // The guard actually gates: detect and every deploy lane require proceed,
  // and a guarded run must never upload the deploy-summary artifact that
  // anchors base resolution.
  assert.match(workflow, /if: \$\{\{ steps\.head\.outputs\.proceed == 'true' \}\}/);
  const gatedJobs = workflow.match(/needs\.plan\.outputs\.proceed == 'true'/g) || [];
  assert.ok(
    gatedJobs.length >= 5,
    `every deploy lane and the summary job must require plan.proceed (found ${gatedJobs.length})`,
  );
});

test("release.yml is the only entrypoint into a production deploy lane", () => {
  const coordinators = workflowNames().filter((name) =>
    PRODUCTION_ENVIRONMENT.test(read(name)),
  );

  assert.deepEqual(coordinators, ["release.yml"]);
});

test("release refs resolve to a full commit SHA before checkout", () => {
  // Release run 32452508826 failed before prepare because actions/checkout
  // treated the abbreviated commit SHA as a ref name. Keep the lower-tier
  // contract explicit: resolve every accepted spelling through the commits API,
  // write the returned full SHA, and give checkout only that output.
  const release = read("release.yml");
  const resolveStart = release.indexOf(
    "- name: Resolve the release ref to a full commit SHA",
  );
  const checkoutStart = release.indexOf("- uses: actions/checkout@", resolveStart);
  const setupNodeStart = release.indexOf("- uses: actions/setup-node@", checkoutStart);

  assert.notEqual(resolveStart, -1, "release.yml must resolve its input ref");
  assert.notEqual(checkoutStart, -1, "release.yml must still check out the release commit");
  assert.notEqual(setupNodeStart, -1, "release.yml prepare step boundaries changed");
  assert.ok(resolveStart < checkoutStart, "release ref resolution must precede checkout");

  const resolver = release.slice(resolveStart, checkoutStart);
  assert.match(resolver, /INPUT_REF: \$\{\{ github\.event\.inputs\.ref \|\| 'main' \}\}/);
  assert.match(
    resolver,
    /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/commits\/\$\{INPUT_REF\}" --jq \.sha/,
  );
  assert.match(resolver, /echo "sha=\$sha" >> "\$GITHUB_OUTPUT"/);

  const checkout = release.slice(checkoutStart, setupNodeStart);
  assert.match(checkout, /ref: \$\{\{ steps\.ref\.outputs\.sha \}\}/);
  assert.doesNotMatch(checkout, /github\.event\.inputs\.ref/);
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
  // _deploy-server.yml) and into Sentry environment values on the server task
  // definition. Every live SSM parameter uses the lowercase spelling and the
  // deploy role's IAM policy is scoped to it case-sensitively, so a capitalized
  // input fails with AccessDeniedException at deploy time. Release run
  // 32450223908 lost its LiteLLM deploy to exactly this, and shipped a server
  // task definition carrying SENTRY_ENVIRONMENT=Production.
  //
  // Not covered by this test: _deploy-server.yml's CloudWatch derivations
  // (`Proliferate/Background/${DEPLOY_ENVIRONMENT}`, `/ecs/proliferate-server-${DEPLOY_ENVIRONMENT}`)
  // match no real resource under EITHER spelling; the live log group is
  // `/ecs/proliferate-prod`. That is a separate defect.
  //
  // The canonical spelling is the environment key in the hosted contract, which
  // is the same token the AWS resources are named after.
  const contract = JSON.parse(
    readFileSync(path.join(repoRoot, "server/deploy/hosted-redis-contract.json"), "utf8"),
  );
  const canonical = new Set(Object.keys(contract.environments));
  assert.ok(canonical.size > 0, "the hosted contract must declare environments");

  // Every `environment:` line is inspected at any indentation, with an inline
  // comment stripped, surrounding quotes removed, and trailing whitespace
  // trimmed, so none of those spellings can smuggle a capitalized value past
  // the check. Expression-valued inputs (`${{ ... }}`) are resolved at run time
  // by the caller, which is itself one of the files checked here.
  for (const [name, expected] of [
    ["release.yml", 3],
    ["deploy-staging.yml", 4],
  ]) {
    const source = read(name);
    const lines = source.split("\n").filter((line) => /^\s*environment:\s*\S/.test(line));
    // Pin the count so a refactor that renames or drops the key trips this test
    // instead of vacuously passing on an empty match set.
    assert.equal(
      lines.length,
      expected,
      `${name}: expected ${expected} environment inputs, found ${lines.length}. ` +
        `Update this test deliberately when the deploy lanes change.`,
    );

    for (const line of lines) {
      const raw = line
        .replace(/^\s*environment:\s*/, "")
        .replace(/\s+#.*$/, "")
        .trim()
        .replace(/^["'](.*)["']$/, "$1");
      if (raw.includes("${{")) {
        continue;
      }
      assert.ok(
        canonical.has(raw),
        `${name}: environment input '${raw}' is not a hosted contract environment key ` +
          `(${[...canonical].join(", ")}). The input is interpolated into SSM paths and ` +
          `Sentry environment values, so the casing must match the AWS resources exactly.`,
      );
    }
  }
});
