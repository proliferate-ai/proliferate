import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generator = path.join(repoRoot, "scripts/generate-updater-manifest.mjs");

const WINDOWS_DIR = "desktop-x86_64-pc-windows-msvc";

// Intel (x86_64) desktop builds are paused 2026-08-20 (release-desktop.yml
// build-desktop matrix); `armOnly` simulates that paused build producing no
// x86_64 artifacts. `windows`/`omitWindowsSig`/`omitDarwinAarch64` simulate
// the Windows beta leg (release.yml's enable_windows_beta, defaulted false)
// producing artifacts, a broken partial publish, and a genuinely broken
// mac build respectively.
// download-artifact@v8 nests each artifact in a directory named after it only
// when two or more artifacts match the download pattern; a single match
// extracts flat, and merge-multiple: true (the release-desktop.yml publish
// jobs) merges flat regardless of count. `flat` reproduces those layouts, and
// applies to the Windows fixture too since the publish jobs merge every
// artifact, Windows included, into one flat directory.
function writeArtifacts(
  root,
  {
    armOnly = false,
    flat = false,
    windows = false,
    omitWindowsSig = false,
    omitDarwinAarch64 = false,
  } = {},
) {
  const artifacts = path.join(root, "artifacts");
  const fixtures = [
    ["desktop-aarch64-apple-darwin", "Proliferate_aarch64.app.tar.gz"],
    ["desktop-x86_64-apple-darwin", "Proliferate_x64.app.tar.gz"],
  ]
    .filter(([directory]) => !armOnly || directory === "desktop-aarch64-apple-darwin")
    .filter(([directory]) => !omitDarwinAarch64 || directory !== "desktop-aarch64-apple-darwin");

  if (windows) {
    fixtures.push([WINDOWS_DIR, "Proliferate_1.2.3_x64-setup.exe"]);
  }

  for (const [directory, artifact] of fixtures) {
    const target = flat ? artifacts : path.join(artifacts, directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, artifact), "archive");
    if (directory === WINDOWS_DIR && omitWindowsSig) continue;
    fs.writeFileSync(path.join(target, `${artifact}.sig`), `signature-${directory}\n`);
  }

  return artifacts;
}

function generateManifest(t, notes, artifactOptions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-updater-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "latest.json");
  const args = [
    generator,
    "--version",
    "1.2.3",
    "--artifacts-dir",
    writeArtifacts(root, artifactOptions),
    "--base-url",
    "https://downloads.proliferate.com/desktop/stable",
    "--output",
    output,
  ];
  if (notes !== undefined) args.push("--notes", notes);

  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { output, result };
}

test("writes a trimmed release title as top-level notes", (t) => {
  const { output, result } = generateManifest(t, "  Introducing Grok  ");

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.notes, "Introducing Grok");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64"]);
});

test("generates an arm-only manifest while Intel is paused", (t) => {
  const { output, result } = generateManifest(t, undefined, { armOnly: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping darwin-x86_64: no artifacts found \(optional platform\)\./);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64"]);
});

test("generates an arm-only manifest from the flat single-artifact layout", (t) => {
  // Regression: the 0.4.22 publish failed because download-artifact@v8
  // extracted the single ARM artifact flat (no desktop-aarch64-apple-darwin/
  // directory) and the matchers required that path segment.
  const { output, result } = generateManifest(t, undefined, { armOnly: true, flat: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64"]);
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_aarch64.app.tar.gz",
  );
  assert.equal(
    manifest.platforms["darwin-aarch64"].signature,
    "signature-desktop-aarch64-apple-darwin",
  );
});

test("generates both platforms from a merged flat layout", (t) => {
  const { output, result } = generateManifest(t, undefined, { flat: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64"]);
  assert.equal(
    manifest.platforms["darwin-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_x64.app.tar.gz",
  );
});

test("omits notes when the release title is absent or blank", (t) => {
  for (const notes of [undefined, "   "]) {
    const { output, result } = generateManifest(t, notes);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(output, "utf8")), "notes"), false);
  }
});

test("accepts an 80-character release title", (t) => {
  const title = "a".repeat(80);
  const { output, result } = generateManifest(t, title);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).notes, title);
});

test("validates and previews a release title without build artifacts", () => {
  const result = spawnSync(
    process.execPath,
    [generator, "--notes", "  Introducing Grok  ", "--validate-notes-only", "true"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Release title: Introducing Grok$/m);
});

test("rejects multiline, control-character, and overlong release titles", (t) => {
  const invalidTitles = [
    ["Introducing\nGrok", /single line/],
    ["Introducing\tGrok", /control characters/],
    ["a".repeat(81), /at most 80 characters/],
  ];

  for (const [notes, expectedError] of invalidTitles) {
    const { output, result } = generateManifest(t, notes);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expectedError);
    assert.equal(fs.existsSync(output), false);
  }
});

test("mac-only artifacts still produce a valid manifest with no windows entry (regression: Windows must never be required)", (t) => {
  const { output, result } = generateManifest(t, undefined, { windows: false });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping windows-x86_64: no artifacts found \(optional platform\)\./);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64"]);
});

test("mac+windows artifacts produce all three platform entries with the windows URL and signature", (t) => {
  const { output, result } = generateManifest(t, undefined, { windows: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(
    manifest.platforms["windows-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_1.2.3_x64-setup.exe",
  );
  assert.equal(manifest.platforms["windows-x86_64"].signature, `signature-${WINDOWS_DIR}`);
});

test("mac+windows artifacts resolve from the merged flat layout the publish jobs produce", (t) => {
  // release-desktop.yml's publish jobs download with merge-multiple: true, so
  // the Windows setup.exe lands in the same flat directory as the darwin
  // tarballs. Only the "-setup.exe" filename suffix separates windows-x86_64
  // from darwin-x86_64 here; there is no directory segment left to lean on.
  const { output, result } = generateManifest(t, undefined, { windows: true, flat: true });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(
    manifest.platforms["windows-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_1.2.3_x64-setup.exe",
  );
  assert.equal(
    manifest.platforms["darwin-x86_64"].url,
    "https://downloads.proliferate.com/desktop/stable/Proliferate_x64.app.tar.gz",
  );
});

test("a windows artifact present without its .sig is a fatal error, never a silent skip", (t) => {
  const { output, result } = generateManifest(t, undefined, { windows: true, omitWindowsSig: true });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing signature file for windows-x86_64/);
  assert.equal(fs.existsSync(output), false);
});

test("a required darwin platform missing artifacts is still fatal even when windows is present", (t) => {
  const { output, result } = generateManifest(t, undefined, { windows: true, omitDarwinAarch64: true });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing signature file for darwin-aarch64/);
  assert.match(result.stderr, /Missing artifact file for darwin-aarch64/);
  assert.equal(fs.existsSync(output), false);
});
