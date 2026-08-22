import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generator = path.join(repoRoot, "scripts/generate-agent-catalog-manifest.mjs");

function writeFixtures(root, overrides = {}) {
  const catalogPath = path.join(root, "catalog.json");
  const registryPath = path.join(root, "registry.json");
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({
      schemaVersion: 2,
      catalogVersion: "2026.08.15-1",
      generatedAt: "2026-08-15T00:00:00Z",
      agents: [],
      ...overrides.catalog,
    }),
  );
  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      schemaVersion: 1,
      registryVersion: "2026.08.15-1",
      generatedAt: "2026-08-15T00:00:00Z",
      agents: [],
      ...overrides.registry,
    }),
  );
  return { catalogPath, registryPath };
}

function run(args, t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-catalog-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "manifest.json");
  const { catalogPath, registryPath } = writeFixtures(root, args.overrides);
  const result = spawnSync(
    process.execPath,
    [generator, "--catalog", catalogPath, "--registry", registryPath, "--output", output],
    { encoding: "utf8" },
  );
  return { output, result };
}

test("writes catalogVersion, registryVersion, generatedAt, and per-file sha256", (t) => {
  const { output, result } = run({}, t);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(manifest.catalogVersion, "2026.08.15-1");
  assert.equal(manifest.registryVersion, "2026.08.15-1");
  assert.equal(manifest.generatedAt, "2026-08-15T00:00:00Z");
  assert.deepEqual(Object.keys(manifest.files).sort(), ["catalog.json", "registry.json"]);
  assert.match(manifest.files["catalog.json"].sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.files["registry.json"].sha256, /^[0-9a-f]{64}$/);
});

test("sha256 changes when the catalog bytes change", (t) => {
  const first = run({}, t);
  const second = run({ overrides: { catalog: { agents: [{ kind: "claude" }] } } }, t);

  const firstManifest = JSON.parse(fs.readFileSync(first.output, "utf8"));
  const secondManifest = JSON.parse(fs.readFileSync(second.output, "utf8"));
  assert.notEqual(
    firstManifest.files["catalog.json"].sha256,
    secondManifest.files["catalog.json"].sha256,
  );
});

test("rejects a catalog document missing catalogVersion", (t) => {
  const { result } = run({ overrides: { catalog: { catalogVersion: undefined } } }, t);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing a string catalogVersion/);
});

test("rejects a catalog document with an unparseable generatedAt", (t) => {
  const { result } = run({ overrides: { catalog: { generatedAt: "not-a-date" } } }, t);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a parseable timestamp/);
});

test("rejects a registry document missing registryVersion", (t) => {
  const { result } = run({ overrides: { registry: { registryVersion: undefined } } }, t);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing a string registryVersion/);
});

test("runs main() when the script path needs URL percent-encoding (space in path)", (t) => {
  // realpath: macOS tmpdir sits behind the /var → /private/var symlink, and
  // node realpaths import.meta.url but not argv[1]; this test targets URL
  // percent-encoding, not symlink resolution.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent catalog manifest ")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copiedGenerator = path.join(root, "generate-agent-catalog-manifest.mjs");
  fs.copyFileSync(generator, copiedGenerator);
  const { catalogPath, registryPath } = writeFixtures(root);
  const output = path.join(root, "manifest.json");
  const result = spawnSync(
    process.execPath,
    [
      copiedGenerator,
      "--catalog",
      catalogPath,
      "--registry",
      registryPath,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(manifest.catalogVersion, "2026.08.15-1");
});
