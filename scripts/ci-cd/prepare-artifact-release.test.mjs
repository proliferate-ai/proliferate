import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildArtifactPlan,
  compareVersions,
  incrementMajor,
  incrementMinor,
  incrementPatch,
  latestReleasedVersionFromTags,
  latestVersionFromTags,
  nextVersion,
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
  assert.equal(incrementMinor("1.2.3"), "1.3.0");
  assert.equal(incrementMajor("1.2.3"), "2.0.0");
});

test("calculates public product versions from current and product tag", () => {
  assert.equal(nextVersion("0.1.49", "0.1.52", "patch"), "0.1.53");
  assert.equal(nextVersion("0.1.49", "0.1.52", "minor"), "0.2.0");
  assert.equal(nextVersion("0.1.49", "0.1.52", "major"), "1.0.0");
  assert.equal(nextVersion("0.1.49", "0.1.52", "none"), "0.1.49");
});

test("extracts latest versions from lane tags", () => {
  assert.equal(tagVersion("desktop-v0.1.4", "desktop-v"), "0.1.4");
  assert.equal(tagVersion("runtime-v0.1.4", "desktop-v"), "");
  assert.equal(latestVersionFromTags(["runtime-v0.1.2", "runtime-v0.1.10"], "runtime-v"), "0.1.10");
});

test("latest released version clears all surface tags, not just the product tag", () => {
  // A desktop hotfix (desktop-v0.2.13) ahead of the product tag must raise the
  // floor, so the next train bumps past it instead of recomputing a colliding tag.
  assert.equal(
    latestReleasedVersionFromTags([
      "proliferate-v0.2.11",
      "desktop-v0.2.13",
      "runtime-v0.2.12",
      "server-v0.2.10",
    ]),
    "0.2.13",
  );
  assert.equal(latestReleasedVersionFromTags([]), "");
});

test("bumps past an artifact hotfix that outran the product tag", () => {
  const root = writeFixtureRoot(); // VERSION fixture = 0.1.49
  const plan = buildArtifactPlan({
    root,
    surfaces: new Set(["desktop", "runtime", "server"]),
    releaseId: "release-2026-06-18",
    versionBump: "patch",
    dryRun: true,
    latestProductTagVersion: "0.2.13", // a desktop hotfix already released 0.2.13
  });

  assert.equal(plan.productVersion, "0.2.14");
  assert.deepEqual(plan.tags, {
    desktop: "desktop-v0.2.14",
    runtime: "runtime-v0.2.14",
    server: "server-v0.2.14",
  });
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-release-test-"));
  fs.writeFileSync(path.join(root, "VERSION"), "0.1.49\n");
  writeJson(path.join(root, "apps/desktop/package.json"), { version: "0.1.49" });
  writeJson(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), { version: "0.1.49" });
  fs.writeFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), '[package]\nversion = "0.1.49"\n');
  writeJson(path.join(root, "anyharness/sdk/package.json"), { version: "0.1.2" });
  return root;
}

test("plans one product version and no artifact tags for web-only releases", () => {
  const root = writeFixtureRoot();
  const plan = buildArtifactPlan({
    root,
    surfaces: new Set(["web"]),
    releaseId: "release-2026-06-06",
    versionBump: "patch",
    dryRun: true,
    latestProductTagVersion: "0.1.49",
  });

  assert.equal(plan.productVersion, "0.1.50");
  assert.equal(plan.productTag, "proliferate-v0.1.50");
  assert.deepEqual(plan.tags, {});
  assert.deepEqual(plan.changedFiles, ["VERSION"]);
});

test("plans matching artifact tags for selected artifact lanes", () => {
  const root = writeFixtureRoot();
  const plan = buildArtifactPlan({
    root,
    surfaces: new Set(["desktop", "runtime", "server"]),
    releaseId: "release-2026-06-06",
    versionBump: "patch",
    dryRun: true,
    latestProductTagVersion: "0.1.49",
  });

  assert.equal(plan.productVersion, "0.1.50");
  assert.equal(plan.productTag, "proliferate-v0.1.50");
  assert.deepEqual(plan.tags, {
    desktop: "desktop-v0.1.50",
    runtime: "runtime-v0.1.50",
    server: "server-v0.1.50",
  });
  assert.deepEqual(plan.versions, {
    desktop: "0.1.50",
    runtime: "0.1.50",
    server: "0.1.50",
  });
});

test("rejects no-version hotfixes for artifact lanes", () => {
  const root = writeFixtureRoot();
  assert.throws(
    () =>
      buildArtifactPlan({
        root,
        surfaces: new Set(["desktop"]),
        releaseId: "hotfix-2026-06-06-1",
        versionBump: "none",
        dryRun: true,
        latestProductTagVersion: "0.1.49",
      }),
    /version_bump=none is only allowed/,
  );
});

test("allows no-version hotfixes for SHA-based surfaces", () => {
  const root = writeFixtureRoot();
  const plan = buildArtifactPlan({
    root,
    surfaces: new Set(["web", "workers"]),
    releaseId: "hotfix-2026-06-06-1",
    versionBump: "none",
    dryRun: true,
    latestProductTagVersion: "0.1.49",
  });

  assert.equal(plan.productVersion, "0.1.49");
  assert.equal(plan.productTag, "");
  assert.deepEqual(plan.tags, {});
  assert.deepEqual(plan.changedFiles, []);
});

test("rejects no-version hotfixes for mobile", () => {
  const root = writeFixtureRoot();
  assert.throws(
    () =>
      buildArtifactPlan({
        root,
        surfaces: new Set(["mobile"]),
        releaseId: "hotfix-2026-06-06-1",
        versionBump: "none",
        dryRun: true,
        latestProductTagVersion: "0.1.49",
      }),
    /version_bump=none is only allowed/,
  );
});
