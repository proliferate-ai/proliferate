import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BuildMapError, type CandidateBuildArtifactV1 } from "./build-map.js";
import { materializeLocalArtifact } from "./materialize-local.js";

async function tempArtifact(content: string): Promise<{ dir: string; artifact: CandidateBuildArtifactV1 }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "materialize-test-"));
  const sourcePath = path.join(dir, "source-binary");
  await writeFile(sourcePath, content);
  return {
    dir,
    artifact: {
      artifact_id: "anyharness/aarch64-apple-darwin",
      version: "0.3.27",
      sha256: createHash("sha256").update(content).digest("hex"),
      locator: { kind: "local_file", path: sourcePath },
    },
  };
}

test("copies exact bytes into run storage, re-verifies the digest, and marks executable", async () => {
  const { dir, artifact } = await tempArtifact("exact-candidate-bytes");
  const storage = await mkdtemp(path.join(os.tmpdir(), "materialize-storage-"));
  try {
    const materialized = await materializeLocalArtifact(artifact, storage);
    assert.ok(materialized.startsWith(storage));
    assert.equal(await readFile(materialized, "utf8"), "exact-candidate-bytes");
    await access(materialized, constants.X_OK);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
});

test("rejects when the source disappears before materialization", async () => {
  const { dir, artifact } = await tempArtifact("bytes");
  const storage = await mkdtemp(path.join(os.tmpdir(), "materialize-storage-"));
  try {
    await rm(artifact.locator.path);
    await assert.rejects(materializeLocalArtifact(artifact, storage), BuildMapError);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
});

test("rejects when the source bytes changed after validation", async () => {
  const { dir, artifact } = await tempArtifact("bytes-at-validation-time");
  const storage = await mkdtemp(path.join(os.tmpdir(), "materialize-storage-"));
  try {
    await writeFile(artifact.locator.path, "bytes-swapped-in-later");
    await assert.rejects(materializeLocalArtifact(artifact, storage), /do not match the declared SHA-256/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
});
