import assert from "node:assert/strict";
import { test } from "node:test";

import { describeGitFailure } from "./git.js";

// Production-path regression for the runtime-credential leak: the clone URL
// embeds a dynamically resolved token (`gh auth token` or
// RELEASE_E2E_GITHUB_TEST_TOKEN), and git also echoes the URL into stderr.
// This is the exact formatting function runGit uses to build its Error.

test("describeGitFailure never renders credential-bearing clone URLs", () => {
  const token = "gho_runtimeResolvedToken42";
  const url = `https://x-access-token:${token}@github.com/proliferate-e2e/e2e-fixture.git`;
  const message = describeGitFailure(
    ["clone", url, "/tmp/dest"],
    "/work",
    128,
    `Cloning into '/tmp/dest'...\nfatal: unable to access '${url}': The requested URL returned error: 403\n`,
  );
  assert.ok(!message.includes(token));
  assert.match(message, /git clone https:\/\/\[REDACTED\]@github\.com/);
  assert.match(message, /fatal: unable to access 'https:\/\/\[REDACTED\]@github\.com/);
  assert.match(message, /failed \(128\)/);
});

test("describeGitFailure leaves credential-free commands readable", () => {
  const message = describeGitFailure(["fetch", "--all", "--prune"], "/repo", 1, "some error\n");
  assert.match(message, /^git fetch --all --prune \(cwd=\/repo\) failed \(1\): some error/);
});
