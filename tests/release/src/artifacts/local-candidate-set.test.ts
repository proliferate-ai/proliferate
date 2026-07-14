import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";
import { resolveLocalCandidateSet } from "./local-candidate-set.js";

function artifact(id: string): CandidateBuildArtifactV1 {
  return {
    artifact_id: id,
    version: "0.0.1",
    sha256: "a".repeat(64),
    locator: { kind: "local_file", path: `/tmp/${encodeURIComponent(id)}` },
  };
}

function mapOf(ids: string[]): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "0".repeat(40),
    artifacts: ids.map(artifact),
  };
}

test("resolves the three required slots by prefix and exact id", () => {
  const set = resolveLocalCandidateSet(
    mapOf(["server/linux-amd64", "anyharness/aarch64-apple-darwin", "desktop-renderer/browser"]),
  );
  assert.equal(set.server.artifact_id, "server/linux-amd64");
  assert.equal(set.anyharness.artifact_id, "anyharness/aarch64-apple-darwin");
  assert.equal(set.desktopRenderer.artifact_id, "desktop-renderer/browser");
});

test("rejects a missing required slot before any world side effect", () => {
  assert.throws(
    () => resolveLocalCandidateSet(mapOf(["server/linux-amd64", "desktop-renderer/browser"])),
    (error: unknown) => error instanceof BuildMapError && /missing the required anyharness/.test((error as Error).message),
  );
});

test("rejects a duplicate slot", () => {
  assert.throws(
    () =>
      resolveLocalCandidateSet(
        mapOf(["server/a", "server/b", "anyharness/t", "desktop-renderer/browser"]),
      ),
    (error: unknown) => error instanceof BuildMapError && /2 server artifacts/.test((error as Error).message),
  );
});

test("rejects an unexpected extra artifact", () => {
  assert.throws(
    () =>
      resolveLocalCandidateSet(
        mapOf(["server/a", "anyharness/t", "desktop-renderer/browser", "catalog/extra"]),
      ),
    (error: unknown) => error instanceof BuildMapError && /unexpected artifact/.test((error as Error).message),
  );
});
