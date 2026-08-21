import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generator = path.join(repoRoot, "scripts/generate-desktop-installer-manifest.mjs");

const WINDOWS_DIR = "desktop-x86_64-pc-windows-msvc";

// download-artifact@v8 nests each artifact in a directory named after it only
// when two or more artifacts match the download pattern; a single match
// extracts flat, and merge-multiple: true (the release-desktop.yml publish
// jobs) merges flat regardless of count. `flat` reproduces those layouts, and
// applies to the Windows fixture too since the publish jobs merge every
// artifact, Windows included, into one flat directory.
// Intel (x86_64) desktop builds are paused 2026-08-20 (release-desktop.yml
// build-desktop matrix); `armOnly` simulates that paused lane producing no
// x86_64 installer. `windows`/`omitDarwinAarch64` simulate the Windows beta
// leg (release.yml's enable_windows_beta, defaulted false) producing an
// installer, and a genuinely broken required mac build respectively.
function writeInstallers(
  root,
  { armOnly = false, flat = false, windows = false, omitDarwinAarch64 = false } = {},
) {
  const artifacts = path.join(root, "artifacts");
  const fixtures = [
    ["desktop-aarch64-apple-darwin", "Proliferate_aarch64.dmg"],
    ["desktop-x86_64-apple-darwin", "Proliferate_x64.dmg"],
  ]
    .filter(([directory]) => !armOnly || directory === "desktop-aarch64-apple-darwin")
    .filter(([directory]) => !omitDarwinAarch64 || directory !== "desktop-aarch64-apple-darwin");

  if (windows) {
    fixtures.push([WINDOWS_DIR, "Proliferate_1.2.3_x64-setup.exe"]);
  }

  for (const [directory, installer] of fixtures) {
    const target = flat ? artifacts : path.join(artifacts, directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, installer), "dmg");
  }

  return artifacts;
}

function generateManifest(t, { empty = false, ...installerOptions } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-installer-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "installers.json");
  const artifactsDir = empty
    ? (() => {
        const dir = path.join(root, "artifacts");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })()
    : writeInstallers(root, installerOptions);

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

test("generates an arm-only manifest while Intel is paused", (t) => {
  const { output, result } = generateManifest(t, { armOnly: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping darwin-x86_64: no installer found \(optional platform\)\./);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads), ["darwin-aarch64"]);
});

test("mac-only artifacts still produce a valid manifest with no windows entry (regression: Windows must never be required)", (t) => {
  const { output, result } = generateManifest(t, { windows: false });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping windows-x86_64: no installer found \(optional platform\)\./);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads).sort(), ["darwin-aarch64", "darwin-x86_64"]);
});

test("mac+windows artifacts produce all three download entries with the windows URL", (t) => {
  const { output, result } = generateManifest(t, { windows: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(
    manifest.downloads["windows-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_1.2.3_x64-setup.exe",
  );
});

test("mac+windows downloads resolve from the merged flat layout the publish jobs produce", (t) => {
  // release-desktop.yml's publish jobs download with merge-multiple: true, so
  // the Windows setup.exe lands in the same flat directory as the darwin
  // dmgs. Only the "-setup.exe" filename suffix separates windows-x86_64 from
  // darwin-x86_64 here; there is no directory segment left to lean on.
  const { output, result } = generateManifest(t, { windows: true, flat: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(
    manifest.downloads["windows-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_1.2.3_x64-setup.exe",
  );
  assert.equal(
    manifest.downloads["darwin-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_x64.dmg",
  );
});

test("a required darwin platform missing its installer is still fatal even when windows is present", (t) => {
  const { output, result } = generateManifest(t, { windows: true, omitDarwinAarch64: true });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing installer file for darwin-aarch64/);
  assert.equal(fs.existsSync(output), false);
});
