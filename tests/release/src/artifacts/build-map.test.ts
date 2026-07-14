import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BuildMapError,
  loadCandidateBuildMap,
  toCandidateBuildEvidence,
  validateCandidateBuildMapShape,
  type CandidateBuildMapV1,
} from "./build-map.js";

const SHA = "a".repeat(40);
const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "artifacts",
  "candidate-build.valid.json",
);

async function withTempMap(
  mutate: (map: CandidateBuildMapV1, dir: string) => void | Promise<void>,
): Promise<{ dir: string; mapPath: string; binaryPath: string; sha256: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "build-map-test-"));
  const binaryPath = path.join(dir, "anyharness");
  const content = "candidate-binary-bytes";
  await writeFile(binaryPath, content);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const map = JSON.parse(await readFile(FIXTURE, "utf8")) as CandidateBuildMapV1;
  map.source_sha = SHA;
  map.artifacts[0].sha256 = sha256;
  map.artifacts[0].locator.path = binaryPath;
  await mutate(map, dir);
  const mapPath = path.join(dir, "candidate-build.json");
  await writeFile(mapPath, JSON.stringify(map, null, 2));
  return { dir, mapPath, binaryPath, sha256 };
}

test("round-trips the valid fixture once its path and digest are real", async () => {
  const { dir, mapPath, sha256 } = await withTempMap(() => undefined);
  try {
    const map = await loadCandidateBuildMap(mapPath, SHA);
    assert.equal(map.artifacts[0].artifact_id, "anyharness/aarch64-apple-darwin");
    assert.equal(map.artifacts[0].sha256, sha256);
    assert.deepEqual(toCandidateBuildEvidence(map), {
      artifacts: [
        { artifact_id: "anyharness/aarch64-apple-darwin", version: "0.3.27", sha256 },
      ],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evidence projection never carries locator paths", async () => {
  const { dir, mapPath } = await withTempMap(() => undefined);
  try {
    const map = await loadCandidateBuildMap(mapPath, SHA);
    const serialized = JSON.stringify(toCandidateBuildEvidence(map));
    assert.ok(!serialized.includes("locator"));
    assert.ok(!serialized.includes(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("strict shape validation rejects unsupported and malformed maps", () => {
  const valid: CandidateBuildMapV1 = {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: SHA,
    artifacts: [
      {
        artifact_id: "anyharness/x",
        version: "1.0.0",
        sha256: "b".repeat(64),
        locator: { kind: "local_file", path: "/tmp/x" },
      },
    ],
  };
  validateCandidateBuildMapShape(valid);

  const reject = (mutate: (map: Record<string, unknown>) => void): void => {
    const clone = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
    mutate(clone);
    assert.throws(() => validateCandidateBuildMapShape(clone), BuildMapError);
  };

  reject((map) => { map.schema_version = 2; });
  reject((map) => { map.kind = "proliferate.retained-build"; });
  reject((map) => { map.source_sha = "ABC"; });
  reject((map) => { map.source_sha = SHA.toUpperCase(); });
  reject((map) => { map.artifacts = []; });
  reject((map) => {
    const artifacts = map.artifacts as Array<Record<string, unknown>>;
    artifacts.push({ ...artifacts[0] });
  });
  reject((map) => { (map.artifacts as Array<Record<string, unknown>>)[0].artifact_id = "../escape"; });
  reject((map) => { (map.artifacts as Array<Record<string, unknown>>)[0].artifact_id = ""; });
  reject((map) => { (map.artifacts as Array<Record<string, unknown>>)[0].version = ""; });
  reject((map) => { (map.artifacts as Array<Record<string, unknown>>)[0].version = "x".repeat(200); });
  reject((map) => { (map.artifacts as Array<Record<string, unknown>>)[0].sha256 = "zz"; });
  reject((map) => {
    (map.artifacts as Array<Record<string, unknown>>)[0].sha256 = "B".repeat(64);
  });
  reject((map) => {
    ((map.artifacts as Array<Record<string, unknown>>)[0].locator as Record<string, unknown>).kind = "oci";
  });
  reject((map) => {
    ((map.artifacts as Array<Record<string, unknown>>)[0].locator as Record<string, unknown>).path = "";
  });
});

test("rejects a source SHA that does not match the run identity", async () => {
  const { dir, mapPath } = await withTempMap(() => undefined);
  try {
    await assert.rejects(loadCandidateBuildMap(mapPath, "b".repeat(40)), BuildMapError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unreadable and invalid-JSON map files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "build-map-test-"));
  try {
    await assert.rejects(loadCandidateBuildMap(path.join(dir, "missing.json"), SHA), BuildMapError);
    const garbled = path.join(dir, "garbled.json");
    await writeFile(garbled, "{not json");
    await assert.rejects(loadCandidateBuildMap(garbled, SHA), BuildMapError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a missing or non-regular artifact file", async () => {
  const missing = await withTempMap((map) => {
    map.artifacts[0].locator.path = `${map.artifacts[0].locator.path}-gone`;
  });
  try {
    await assert.rejects(loadCandidateBuildMap(missing.mapPath, SHA), /not readable/);
  } finally {
    await rm(missing.dir, { recursive: true, force: true });
  }

  const directory = await withTempMap((map, dir) => {
    map.artifacts[0].locator.path = dir;
  });
  try {
    await assert.rejects(loadCandidateBuildMap(directory.mapPath, SHA), /not a regular file/);
  } finally {
    await rm(directory.dir, { recursive: true, force: true });
  }

  // A symlink to a regular file resolves through stat() to that file; a
  // dangling symlink must reject.
  const dangling = await withTempMap(async (map, dir) => {
    const link = path.join(dir, "dangling");
    await symlink(path.join(dir, "nowhere"), link);
    map.artifacts[0].locator.path = link;
  });
  try {
    await assert.rejects(loadCandidateBuildMap(dangling.mapPath, SHA), BuildMapError);
  } finally {
    await rm(dangling.dir, { recursive: true, force: true });
  }
});

test("rejects bytes changed after the map was assembled (tamper)", async () => {
  const { dir, mapPath, binaryPath } = await withTempMap(() => undefined);
  try {
    await writeFile(binaryPath, "tampered-bytes-after-assembly");
    await assert.rejects(loadCandidateBuildMap(mapPath, SHA), /do not match the declared SHA-256/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
