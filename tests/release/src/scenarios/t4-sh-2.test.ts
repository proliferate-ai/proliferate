import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertExactUpdaterPlatforms,
  lineageAssertion,
  resolveExpectedReleaseDate,
  resolvePublishedDesktopVersion,
  updaterPlatformKeys,
} from "./upgrade/t4-sh-2.js";

test("published diagnostic resolves the shipped CDN version instead of the repo VERSION", () => {
  assert.equal(resolvePublishedDesktopVersion(undefined, "0.3.24"), "0.3.24");
  assert.equal(resolvePublishedDesktopVersion(" 0.3.25 ", "0.3.24"), "0.3.25");
});

test("an exact candidate can only be an ancestor of the published desktop tag", () => {
  assert.deepEqual(lineageAssertion("candidate-sha", "tag-sha", "head-sha"), {
    ancestor: "candidate-sha",
    descendant: "tag-sha",
    mode: "exact-candidate",
  });
});

test("published monitoring separately checks that the tag is on the remote mainline", () => {
  assert.deepEqual(lineageAssertion(undefined, "tag-sha", "main-sha"), {
    ancestor: "tag-sha",
    descendant: "main-sha",
    mode: "published-diagnostic",
  });
});

test("release freshness uses an annotated tag created after its target commit", () => {
  assert.equal(resolveExpectedReleaseDate(undefined, "2026-07-12T01:33:39Z"), "2026-07-12");
  assert.equal(resolveExpectedReleaseDate("2026-07-12", "2026-07-11T01:33:39Z"), "2026-07-12");
});

test("git creatordate uses an annotated tag's tagger day instead of its target commit day", () => {
  const repo = mkdtempSync(join(tmpdir(), "proliferate-release-tag-date-"));
  const git = (args: string[], env: NodeJS.ProcessEnv = process.env): string => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  try {
    git(["init", "--quiet"]);
    git(["config", "user.name", "Release Test"]);
    git(["config", "user.email", "release-test@example.test"]);
    writeFileSync(join(repo, "artifact.txt"), "candidate\n");
    git(["add", "artifact.txt"]);
    git(["commit", "--quiet", "-m", "candidate"], {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-10T10:00:00Z",
    });
    git(["tag", "-a", "desktop-v-test", "-m", "published later"], {
      ...process.env,
      GIT_COMMITTER_DATE: "2026-07-12T12:00:00Z",
    });

    assert.match(git(["show", "-s", "--format=%cI", "desktop-v-test^{commit}"]), /^2026-07-10/);
    assert.match(
      git(["for-each-ref", "--format=%(creatordate:iso-strict)", "refs/tags/desktop-v-test"]),
      /^2026-07-12/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("updater platform contract requires a unique non-empty platform list", () => {
  assert.deepEqual(updaterPlatformKeys({ schemaVersion: 1, platforms: ["darwin-aarch64", "darwin-x86_64"] }), [
    "darwin-aarch64",
    "darwin-x86_64",
  ]);
  assert.throws(() => updaterPlatformKeys({ schemaVersion: 1, platforms: [] }), /contract is empty/);
  assert.throws(
    () => updaterPlatformKeys({ schemaVersion: 1, platforms: ["darwin-aarch64", "darwin-aarch64"] }),
    /duplicate keys/,
  );
});

test("published manifest fails when any shipped updater platform is absent or unexpected", () => {
  const expected = ["darwin-aarch64", "darwin-x86_64"];
  assert.doesNotThrow(() => assertExactUpdaterPlatforms([...expected].reverse(), expected));
  assert.throws(() => assertExactUpdaterPlatforms(["darwin-aarch64"], expected), /platform set/);
  assert.throws(
    () => assertExactUpdaterPlatforms([...expected, "windows-x86_64"], expected),
    /platform set/,
  );
});
