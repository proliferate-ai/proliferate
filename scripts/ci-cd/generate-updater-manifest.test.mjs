import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generator = path.join(repoRoot, "scripts/generate-updater-manifest.mjs");

function writeArtifacts(root) {
  const artifacts = path.join(root, "artifacts");
  const fixtures = [
    ["desktop-aarch64-apple-darwin", "Proliferate_aarch64.app.tar.gz"],
    ["desktop-x86_64-apple-darwin", "Proliferate_x64.app.tar.gz"],
  ];

  for (const [directory, artifact] of fixtures) {
    const target = path.join(artifacts, directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, artifact), "archive");
    fs.writeFileSync(path.join(target, `${artifact}.sig`), `signature-${directory}\n`);
  }

  return artifacts;
}

function generateManifest(t, notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-updater-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "latest.json");
  const args = [
    generator,
    "--version",
    "1.2.3",
    "--artifacts-dir",
    writeArtifacts(root),
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
