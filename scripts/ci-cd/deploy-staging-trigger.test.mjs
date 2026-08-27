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

test("staging deploys from green main and from an operator", () => {
  const triggers = triggerBlock(workflow, "deploy-staging.yml");

  // The one automated transition: a completed `CI` run on main.
  assert.match(
    triggers,
    /workflow_run:\n    workflows: \["CI"\]\n    types: \[completed\]\n    branches: \[main\]/,
  );
  // Operators keep dispatch for reruns, forced surfaces, and dry runs.
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\bpush:/);
  assert.doesNotMatch(triggers, /\bschedule:/);

  // Auto runs deploy only what CI proved: the plan job refuses non-success
  // conclusions, and the checkout pins the triggering run's exact head SHA.
  assert.match(
    workflow,
    /github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.conclusion == 'success'/,
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
    /FORCE_SURFACES: \$\{\{ github\.event\.inputs\.force_surfaces \|\| \(steps\.base\.outputs\.base_mode == 'fallback' && 'all'\) \|\| '' \}\}/,
  );
});

test("deploy-staging is the only workflow that auto-deploys from main", () => {
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

  // Staging is the sanctioned automatic transition; production reaches a
  // deploy lane only through release.yml's cron/dispatch (pinned below).
  assert.deepEqual(automatic, ["deploy-staging.yml"]);
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
