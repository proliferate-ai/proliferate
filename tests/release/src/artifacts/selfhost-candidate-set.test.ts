import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";
import { resolveSelfHostCandidateSet } from "./selfhost-candidate-set.js";

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

const FULL = [
  "server/linux/amd64",
  "selfhost-bundle/linux/amd64",
  "anyharness/x86_64-unknown-linux-gnu",
  "desktop-renderer/browser",
];

test("resolves the four required slots by prefix and exact id", () => {
  const set = resolveSelfHostCandidateSet(mapOf(FULL));
  assert.equal(set.serverImage.artifact_id, "server/linux/amd64");
  assert.equal(set.bundle.artifact_id, "selfhost-bundle/linux/amd64");
  assert.equal(set.anyharness.artifact_id, "anyharness/x86_64-unknown-linux-gnu");
  assert.equal(set.desktopRenderer.artifact_id, "desktop-renderer/browser");
  assert.equal(set.runtimeBundle, undefined);
});

test("accepts one optional platform runtime bundle for the CFN posture", () => {
  const set = resolveSelfHostCandidateSet(mapOf([...FULL, "selfhost-runtime/linux/arm64"]));
  assert.equal(set.runtimeBundle?.artifact_id, "selfhost-runtime/linux/arm64");
});

test("server/ and selfhost-bundle/ slots are disjoint (bundle is not matched as the server image)", () => {
  // `selfhost-bundle/*` does not start with `server/`, so exactly one artifact
  // fills each slot even though both carry a linux/<arch> suffix.
  const set = resolveSelfHostCandidateSet(mapOf(FULL));
  assert.notEqual(set.serverImage.artifact_id, set.bundle.artifact_id);
});

test("rejects a missing required slot before any world side effect", () => {
  assert.throws(
    () => resolveSelfHostCandidateSet(mapOf(FULL.filter((id) => !id.startsWith("selfhost-bundle/")))),
    (error: unknown) =>
      error instanceof BuildMapError && /missing the required self-host bundle/.test((error as Error).message),
  );
});

test("rejects a missing server image slot", () => {
  assert.throws(
    () => resolveSelfHostCandidateSet(mapOf(FULL.filter((id) => !id.startsWith("server/")))),
    (error: unknown) =>
      error instanceof BuildMapError && /missing the required server image/.test((error as Error).message),
  );
});

test("rejects a duplicate slot", () => {
  assert.throws(
    () =>
      resolveSelfHostCandidateSet(
        mapOf([
          "server/linux/amd64",
          "server/linux/arm64",
          "selfhost-bundle/linux/amd64",
          "anyharness/t",
          "desktop-renderer/browser",
        ]),
      ),
    (error: unknown) => error instanceof BuildMapError && /2 server image artifacts/.test((error as Error).message),
  );
});

test("rejects an unexpected extra artifact", () => {
  assert.throws(
    () => resolveSelfHostCandidateSet(mapOf([...FULL, "catalog/extra"])),
    (error: unknown) => error instanceof BuildMapError && /unexpected artifact/.test((error as Error).message),
  );
});

test("rejects duplicate optional runtime bundles", () => {
  assert.throws(
    () =>
      resolveSelfHostCandidateSet(
        mapOf([...FULL, "selfhost-runtime/linux/amd64", "selfhost-runtime/linux/arm64"]),
      ),
    (error: unknown) =>
      error instanceof BuildMapError && /2 self-host runtime bundle artifacts/.test((error as Error).message),
  );
});
