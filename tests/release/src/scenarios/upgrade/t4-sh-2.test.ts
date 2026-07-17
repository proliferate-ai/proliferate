import assert from "node:assert/strict";
import { test } from "node:test";

import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import { releaseDesktopVersion } from "./t4-sh-2.js";

function candidate(version: string): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [{
      artifact_id: "desktop-renderer/browser",
      version,
      sha256: "b".repeat(64),
      locator: { kind: "local_file", path: "/tmp/renderer.tar.gz" },
    }],
  };
}

test("desktop artifact-chain version comes from the exact candidate receipt", () => {
  const previous = process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION;
  process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION = "0.3.40-stale";
  try {
    assert.equal(releaseDesktopVersion(candidate("0.3.41")), "0.3.41");
  } finally {
    if (previous === undefined) {
      delete process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION;
    } else {
      process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION = previous;
    }
  }
});

test("an exact candidate map without the desktop receipt fails closed", () => {
  const receipt = candidate("0.3.41");
  receipt.artifacts = [];
  assert.throws(() => releaseDesktopVersion(receipt), /exactly one desktop-renderer\/browser/);
});
