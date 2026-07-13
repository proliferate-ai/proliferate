import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildDevCandidateManifest, detectHostPlatformKey } from "./dev-candidate-builder.js";
import { parseCandidateManifest } from "./candidate-manifest.js";

test("detectHostPlatformKey maps known platform/arch pairs and returns null otherwise", () => {
  assert.equal(detectHostPlatformKey("darwin", "arm64"), "darwin-aarch64");
  assert.equal(detectHostPlatformKey("darwin", "x64"), "darwin-x86_64");
  assert.equal(detectHostPlatformKey("linux", "x64"), "linux-x86_64");
  assert.equal(detectHostPlatformKey("linux", "arm64"), "linux-aarch64");
  assert.equal(detectHostPlatformKey("win32", "x64"), null);
});

async function withTempRepo(fn: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "dev-candidate-"));
  try {
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test("builds a manifest that passes strict validation, with unbuilt slots explicitly unavailable", async () => {
  await withTempRepo(async (repoRoot) => {
    const manifest = buildDevCandidateManifest({
      repoRoot,
      platform: "linux-x86_64",
      runGit: (args) => (args[0] === "rev-parse" ? "9f2c1e7abc1234567890abcdef1234567890abcd" : ""),
    });

    // Passes the same strict validator every other candidate manifest does.
    assert.doesNotThrow(() => parseCandidateManifest(manifest));

    assert.equal(manifest.serverImage.available, false);
    assert.equal(manifest.webBuild.available, false);
    assert.equal(manifest.desktopApp.available, false);
    assert.equal(manifest.e2bTemplate.available, false);
    assert.equal(manifest.selfHostBundle.available, false);
    assert.equal(manifest.litellm.available, false);
    assert.equal(manifest.catalogHash.available, false);
    assert.equal(manifest.registryHash.available, false);
    assert.equal(manifest.anyharness["linux-x86_64"]?.available, false);
    if (manifest.anyharness["linux-x86_64"]?.available === false) {
      assert.match(manifest.anyharness["linux-x86_64"].reason, /no built "anyharness" binary/);
    }
  });
});

test("picks up a built binary and real catalog/registry files, hashing real bytes", async () => {
  await withTempRepo(async (repoRoot) => {
    await mkdir(path.join(repoRoot, "target/release"), { recursive: true });
    await writeFile(path.join(repoRoot, "target/release/anyharness"), "fake-binary-bytes");
    await mkdir(path.join(repoRoot, "catalogs/agents"), { recursive: true });
    await writeFile(path.join(repoRoot, "catalogs/agents/catalog.json"), JSON.stringify({ agents: [] }));
    await writeFile(path.join(repoRoot, "catalogs/agents/registry.json"), JSON.stringify({ registry: [] }));

    const manifest = buildDevCandidateManifest({
      repoRoot,
      platform: "linux-x86_64",
      runGit: (args) => (args[0] === "rev-parse" ? "9f2c1e7abc1234567890abcdef1234567890abcd" : ""),
    });

    assert.equal(manifest.anyharness["linux-x86_64"]?.available, true);
    if (manifest.anyharness["linux-x86_64"]?.available === true) {
      assert.equal(manifest.anyharness["linux-x86_64"].value.digest.length, 64);
      assert.equal(manifest.anyharness["linux-x86_64"].value.sizeBytes, "fake-binary-bytes".length);
    }
    assert.equal(manifest.catalogHash.available, true);
    assert.equal(manifest.registryHash.available, true);
    assert.doesNotThrow(() => parseCandidateManifest(manifest));
  });
});

test("never fabricates a digest: an undetected platform leaves the per-platform maps empty, not falsely unavailable under a guessed key", async () => {
  await withTempRepo(async (repoRoot) => {
    const manifest = buildDevCandidateManifest({
      repoRoot,
      platform: null,
      runGit: (args) => (args[0] === "rev-parse" ? "9f2c1e7abc1234567890abcdef1234567890abcd" : ""),
    });
    assert.deepEqual(manifest.anyharness, {});
    assert.deepEqual(manifest.worker, {});
    assert.deepEqual(manifest.supervisor, {});
    assert.doesNotThrow(() => parseCandidateManifest(manifest));
  });
});

test("sourceContentHash changes between a clean and a dirty git status for the same SHA", async () => {
  await withTempRepo(async (repoRoot) => {
    const sha = "9f2c1e7abc1234567890abcdef1234567890abcd";
    const clean = buildDevCandidateManifest({
      repoRoot,
      platform: null,
      runGit: (args) => (args[0] === "rev-parse" ? sha : ""),
    });
    const dirty = buildDevCandidateManifest({
      repoRoot,
      platform: null,
      runGit: (args) => (args[0] === "rev-parse" ? sha : " M some/file.ts\n"),
    });
    assert.equal(clean.sourceSha, dirty.sourceSha);
    assert.notEqual(clean.sourceContentHash, dirty.sourceContentHash);
  });
});
