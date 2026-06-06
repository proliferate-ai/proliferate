import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVersions,
  incrementPatch,
  latestVersionFromTags,
  nextPatchVersion,
  tagVersion,
} from "./prepare-artifact-release.mjs";

import {
  parseTags,
  validateTagTargets,
} from "./create-release-tags.mjs";

test("calculates the next patch version from current and latest tag", () => {
  assert.equal(nextPatchVersion("0.1.49", "0.1.52"), "0.1.53");
  assert.equal(nextPatchVersion("0.1.49", "0.1.42"), "0.1.50");
  assert.equal(nextPatchVersion("0.1.49", ""), "0.1.50");
});

test("orders semver versions", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareVersions("0.1.9", "0.1.9"), 0);
  assert.equal(incrementPatch("1.2.3"), "1.2.4");
});

test("extracts latest versions from lane tags", () => {
  assert.equal(tagVersion("desktop-v0.1.4", "desktop-v"), "0.1.4");
  assert.equal(tagVersion("runtime-v0.1.4", "desktop-v"), "");
  assert.equal(latestVersionFromTags(["runtime-v0.1.2", "runtime-v0.1.10"], "runtime-v"), "0.1.10");
});

test("parses release tag CSV", () => {
  assert.deepEqual(parseTags("release-2026-06-06, runtime-v0.1.3"), [
    "release-2026-06-06",
    "runtime-v0.1.3",
  ]);
});

test("tag validation fails on collisions", () => {
  assert.throws(
    () =>
      validateTagTargets({
        tags: ["runtime-v0.1.3"],
        target: "next",
        existingTargets: { "runtime-v0.1.3": "old" },
      }),
    /runtime-v0\.1\.3 exists at old, not next/,
  );
});

test("tag validation allows existing tags at the same target", () => {
  assert.doesNotThrow(() =>
    validateTagTargets({
      tags: ["runtime-v0.1.3"],
      target: "same",
      existingTargets: { "runtime-v0.1.3": "same" },
    }),
  );
});
