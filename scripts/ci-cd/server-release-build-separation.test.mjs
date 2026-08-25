import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Tests gate the PR -> main transition. The main -> production transition
// builds artifacts and deploys them; it does not re-test. Release run
// 32450223908 spent 5m17s of its critical path re-running lint, test-unit, and
// three test-integration shards on a head that had already passed the identical
// suite as `server-ci-ok` on its way into main. `_build-server.yml` is the
// separation: it is the release build for the server surface with no test lane
// in it, and this file is what keeps a test lane from creeping back in.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDir = path.join(repoRoot, ".github/workflows");

function read(name) {
  return readFileSync(path.join(workflowDir, name), "utf8");
}

const buildServer = read("_build-server.yml");
const serverCi = read("server-ci.yml");
const release = read("release.yml");

// Splits a workflow's `jobs:` mapping into { name -> body } without a YAML
// dependency. A top-level job header is the only `^  <name>:$` line inside the
// jobs block; everything until the next such line is that job's body.
function jobs(source, name) {
  const start = source.indexOf("\njobs:\n");
  assert.notEqual(start, -1, `${name}: no jobs: block`);
  const block = source.slice(start);
  const headers = [...block.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_-]*):$/gm)];
  assert.ok(headers.length > 0, `${name}: parsed zero jobs`);
  return new Map(
    headers.map((match, index) => {
      const bodyStart = match.index + match[0].length;
      const bodyEnd = index + 1 < headers.length ? headers[index + 1].index : block.length;
      return [match[1], block.slice(bodyStart, bodyEnd)];
    }),
  );
}

// The literal publish gate both release jobs carry. Kept verbatim from
// server-ci.yml. Its `server-v` tag-push leg is currently unreachable (no
// caller triggers this workflow from a tag push today) and is retained
// unchanged only to stay byte-comparable with server-ci.yml and to support a
// possible future tag-triggered caller.
const PUBLISH_GATE =
  "if: (startsWith(github.ref, 'refs/tags/server-v')) || " +
  "(inputs.publish == true && inputs.dry_run != true)";

test("the release build brick carries no lint or test lane", () => {
  const buildJobs = jobs(buildServer, "_build-server.yml");

  // Pinned, not merely "no test job": a renamed suite must trip this too.
  assert.deepEqual([...buildJobs.keys()], ["docker", "self-hosted-release-assets"]);

  for (const [name, body] of buildJobs) {
    assert.doesNotMatch(
      body,
      /\b(pytest|ruff|mypy|check_mypy_baseline|vitest|cargo test)\b/,
      `${name}: the release build must not run a test or lint suite. ` +
        `Tests gate PR -> main; this SHA is already on main.`,
    );
    assert.doesNotMatch(
      body,
      /needs:.*\b(lint|test-unit|test-integration)\b/,
      `${name}: must not depend on a validation lane`,
    );
  }

  // The rationale is load-bearing documentation, not decoration: it is the only
  // place that explains why re-adding a test job here is the wrong fix.
  assert.match(buildServer, /THERE ARE DELIBERATELY NO TEST OR LINT JOBS HERE\./);
  assert.match(buildServer, /PR -> main transition/);
  assert.match(buildServer, /server-ci-ok/);
});

test("the release build brick is reusable-only, like the other lane bricks", () => {
  const triggers = buildServer.slice(
    buildServer.indexOf("\non:"),
    buildServer.indexOf("\ndefaults:"),
  );

  assert.match(triggers, /^  workflow_call:$/m);
  assert.doesNotMatch(triggers, /^  push:$/m);
  assert.doesNotMatch(triggers, /^  pull_request:$/m);
  assert.doesNotMatch(triggers, /^  schedule:$/m);
  assert.doesNotMatch(triggers, /^  workflow_dispatch:$/m);
});

test("release.yml builds the server through the brick, never through Server CI", () => {
  const releaseJobs = jobs(release, "release.yml");
  const server = releaseJobs.get("release-server");
  assert.ok(server, "release.yml must still have a release-server job");

  assert.match(server, /uses: \.\/\.github\/workflows\/_build-server\.yml/);
  assert.doesNotMatch(
    release,
    /uses: \.\/\.github\/workflows\/server-ci\.yml/,
    "a production release must not re-run the PR gate it already passed",
  );

  // Permissions the brick's jobs need, declared at the caller.
  assert.match(server, /^ {6}contents: write$/m);
  assert.match(server, /^ {6}packages: write$/m);
  assert.match(server, /^ {4}secrets: inherit$/m);
});

test("every input release.yml passes is one the brick declares, and vice versa", () => {
  // A reusable call with an undeclared input is a hard workflow error at
  // dispatch time, and a required input the caller drops is the same. This is
  // the wiring proof a dry run cannot give us, because a dry run skips this job.
  const declared = [
    ...buildServer
      .slice(buildServer.indexOf("  workflow_call:"), buildServer.indexOf("\ndefaults:"))
      .matchAll(/^ {6}([a-z_]+):$/gm),
  ].map((match) => match[1]);
  assert.deepEqual(declared.sort(), ["dry_run", "git_sha", "publish", "version"]);

  const server = jobs(release, "release.yml").get("release-server");
  const withBlock = server.slice(server.indexOf("    with:"), server.indexOf("    secrets:"));
  const passed = [...withBlock.matchAll(/^ {6}([a-z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(passed.sort(), ["dry_run", "git_sha", "publish", "version"]);

  assert.match(withBlock, /git_sha: \$\{\{ needs\.prepare\.outputs\.head_sha \}\}/);
  assert.match(withBlock, /version: \$\{\{ needs\.prepare\.outputs\.server_version \}\}/);
  assert.match(withBlock, /dry_run: false/);
  assert.match(withBlock, /publish: true/);
});

test("the brick preserves the publish gate, image tags, and release tag semantics", () => {
  const buildJobs = jobs(buildServer, "_build-server.yml");

  for (const [name, body] of buildJobs) {
    assert.ok(body.includes(PUBLISH_GATE), `${name}: publish gate changed`);
  }

  // self-hosted-release-assets consumes the image build, and nothing else.
  assert.match(buildJobs.get("self-hosted-release-assets"), /^ {4}needs: \[docker\]$/m);

  // Immutable version tag plus the rolling :stable tag the self-host compose
  // bundle defaults to, for both the server and the LiteLLM wrapper.
  const docker = buildJobs.get("docker");
  assert.match(docker, /TAGS\+=\("\$\{GHCR_IMAGE\}:\$\{VERSION\}" "\$\{GHCR_IMAGE\}:stable"\)/);
  assert.match(
    docker,
    /LITELLM_TAGS\+=\("\$\{LITELLM_IMAGE\}:\$\{VERSION\}" "\$\{LITELLM_IMAGE\}:stable"\)/,
  );
  assert.match(docker, /file: server\/Dockerfile/);
  assert.match(docker, /file: server\/litellm\/Dockerfile/);

  // The server-v tag is minted by the publish path only, and never moved onto a
  // different commit than the one being released.
  const assets = buildJobs.get("self-hosted-release-assets");
  const tagStep = assets.slice(
    assets.indexOf("- name: Ensure server release tag exists"),
    assets.indexOf("- name: Publish self-hosted release assets"),
  );
  assert.notEqual(tagStep, "", "the release tag step must survive the move");
  assert.match(tagStep, /if: inputs\.publish == true && inputs\.dry_run != true/);
  assert.match(tagStep, /RELEASE_TAG: \$\{\{ format\('server-v\{0\}', inputs\.version\) \}\}/);
  assert.match(tagStep, /already exists at \$existing_target/);
});

test("Server CI is now a gate only and publishes nothing", () => {
  const ciJobs = jobs(serverCi, "server-ci.yml");

  assert.deepEqual(
    [...ciJobs.keys()],
    ["changes", "build-artifact-runtime", "lint", "test-unit", "test-integration", "server-ci-ok"],
  );
  assert.doesNotMatch(serverCi, /docker\/build-push-action/);
  assert.doesNotMatch(serverCi, /softprops\/action-gh-release/);
  assert.doesNotMatch(serverCi, /packages: write/);
  // No publishing inputs left on a workflow that cannot publish.
  assert.doesNotMatch(serverCi, /^ {6}(publish|dry_run|version):$/m);
});

test("server-ci-ok still rolls up every non-release lane in its own file", () => {
  // Mirrors the drift guard's own ruby: a job is exempt from the rollup only by
  // carrying the server-v release gate, never by name. Nothing is exempt today,
  // so the rollup must cover every job in the file except itself.
  const ciJobs = jobs(serverCi, "server-ci.yml");
  const exempt = [...ciJobs]
    .filter(([, body]) => /^ {4}if:.*refs\/tags\/server-v/m.test(body))
    .map(([name]) => name);
  assert.deepEqual(exempt, []);

  const rollup = ciJobs.get("server-ci-ok");
  const needs = [...rollup.matchAll(/^ {6}- ([a-z-]+)$/gm)].map((match) => match[1]);
  assert.deepEqual(
    needs.sort(),
    [...ciJobs.keys()].filter((name) => name !== "server-ci-ok").sort(),
  );

  // The gating contract itself: always-run, and the required check keeps its
  // name so branch protection keeps resolving it.
  assert.match(rollup, /^ {4}name: server-ci-ok$/m);
  assert.match(rollup, /^ {4}if: always\(\)$/m);
  for (const [name, body] of ciJobs) {
    if (name === "changes") continue;
    assert.match(body, /^ {4}if: always\(\)$/m, `${name}: lane must not become skippable`);
  }
});

test("production can still only ship a commit that reached main", () => {
  // The whole separation rests on this: if a release could build a head that
  // never landed on main, dropping the test lane would drop the only gate.
  const prepare = jobs(release, "release.yml").get("prepare");
  assert.match(prepare, /git merge-base --is-ancestor "\$head_sha" refs\/remotes\/origin\/main/);
});
