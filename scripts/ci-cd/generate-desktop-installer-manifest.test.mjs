import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generator = path.join(repoRoot, "scripts/generate-desktop-installer-manifest.mjs");

// download-artifact@v8 nests each artifact in a directory named after it only
// when two or more artifacts match the download pattern; a single match
// extracts flat, and merge-multiple: true (the release-desktop.yml publish
// jobs) merges flat regardless of count. `flat` reproduces those layouts.
// Intel (x86_64) desktop builds are paused 2026-08-20 (release-desktop.yml
// build-desktop matrix); `armOnly` simulates that paused lane producing no
// x86_64 installer.
function writeInstallers(root, { armOnly = false, flat = false } = {}) {
  const artifacts = path.join(root, "artifacts");
  const fixtures = [
    ["desktop-aarch64-apple-darwin", "Proliferate_aarch64.dmg"],
    ["desktop-x86_64-apple-darwin", "Proliferate_x64.dmg"],
  ].filter(([directory]) => !armOnly || directory === "desktop-aarch64-apple-darwin");

  for (const [directory, installer] of fixtures) {
    const target = flat ? artifacts : path.join(artifacts, directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, installer), "dmg");
  }

  return artifacts;
}

function generateManifest(t, { armOnly = false, flat = false, empty = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-installer-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "installers.json");
  const artifactsDir = empty
    ? (() => {
        const dir = path.join(root, "artifacts");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })()
    : writeInstallers(root, { armOnly, flat });

  const result = spawnSync(
    process.execPath,
    [
      generator,
      "--version",
      "1.2.3",
      "--artifacts-dir",
      artifactsDir,
      "--base-url",
      "https://downloads.proliferate.com/desktop/stable",
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  return { output, result };
}

test("generates both downloads from the nested per-artifact layout", (t) => {
  const { output, result } = generateManifest(t);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(Object.keys(manifest.downloads).sort(), ["darwin-aarch64", "darwin-x86_64"]);
});

test("generates an arm-only manifest from the flat single-artifact layout", (t) => {
  // Regression companion to generate-updater-manifest.test.mjs: the 0.4.22
  // publish failed because download-artifact@v8 extracted the single ARM
  // artifact flat and the matchers required a per-artifact directory segment.
  const { output, result } = generateManifest(t, { armOnly: true, flat: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping darwin-x86_64: no installer found \(optional platform\)\./);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads), ["darwin-aarch64"]);
  assert.equal(
    manifest.downloads["darwin-aarch64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_aarch64.dmg",
  );
});

test("generates both downloads from a merged flat layout", (t) => {
  const { output, result } = generateManifest(t, { flat: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads).sort(), ["darwin-aarch64", "darwin-x86_64"]);
});

test("fails when the required darwin-aarch64 installer is missing", (t) => {
  const { output, result } = generateManifest(t, { empty: true });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing installer file for darwin-aarch64/);
  assert.equal(fs.existsSync(output), false);
});
