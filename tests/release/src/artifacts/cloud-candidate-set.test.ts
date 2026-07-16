import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";
import { resolveCloudCandidateSet } from "./cloud-candidate-set.js";

const REQUIRED = [
  "server/linux/amd64",
  "anyharness/x86_64-unknown-linux-musl",
  "worker/x86_64-unknown-linux-musl",
  "supervisor/x86_64-unknown-linux-musl",
  "credential-helper/x86_64-unknown-linux-musl",
  "desktop-renderer/browser",
];

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

test("resolves the six required slots (server by prefix, the rest by exact id)", () => {
  const set = resolveCloudCandidateSet(mapOf(REQUIRED));
  assert.equal(set.server.artifact_id, "server/linux/amd64");
  assert.equal(set.anyharness.artifact_id, "anyharness/x86_64-unknown-linux-musl");
  assert.equal(set.worker.artifact_id, "worker/x86_64-unknown-linux-musl");
  assert.equal(set.supervisor.artifact_id, "supervisor/x86_64-unknown-linux-musl");
  assert.equal(set.credentialHelper.artifact_id, "credential-helper/x86_64-unknown-linux-musl");
  assert.equal(set.desktopRenderer.artifact_id, "desktop-renderer/browser");
});

test("rejects a missing required slot before any world side effect", () => {
  assert.throws(
    () => resolveCloudCandidateSet(mapOf(REQUIRED.filter((id) => !id.startsWith("worker/")))),
    (error: unknown) => error instanceof BuildMapError && /missing the required worker/.test((error as Error).message),
  );
});

test("rejects a duplicate server slot", () => {
  assert.throws(
    () => resolveCloudCandidateSet(mapOf([...REQUIRED, "server/linux/arm64"])),
    (error: unknown) => error instanceof BuildMapError && /2 server artifacts/.test((error as Error).message),
  );
});

test("rejects a wrong-target runtime binary (musl target is pinned exactly)", () => {
  const swapped = REQUIRED.map((id) =>
    id === "worker/x86_64-unknown-linux-musl" ? "worker/aarch64-unknown-linux-musl" : id,
  );
  assert.throws(
    () => resolveCloudCandidateSet(mapOf(swapped)),
    (error: unknown) => error instanceof BuildMapError && /missing the required worker/.test((error as Error).message),
  );
});

test("rejects an unexpected extra artifact", () => {
  assert.throws(
    () => resolveCloudCandidateSet(mapOf([...REQUIRED, "catalog/extra"])),
    (error: unknown) => error instanceof BuildMapError && /unexpected artifact/.test((error as Error).message),
  );
});
