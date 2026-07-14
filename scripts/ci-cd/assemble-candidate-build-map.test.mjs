import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { assembleCandidateBuildMap } from "./assemble-candidate-build-map.mjs";

const SHA = "a".repeat(40);

function tempBinary(dir, content = "fake-binary-bytes") {
  const binaryPath = path.join(dir, "anyharness");
  writeFileSync(binaryPath, content);
  return { binaryPath, sha256: createHash("sha256").update(content).digest("hex") };
}

test("assembles a valid local_file candidate build map", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "assemble-map-"));
  try {
    const { binaryPath, sha256 } = tempBinary(dir);
    const map = assembleCandidateBuildMap({
      binaryPath,
      sourceSha: SHA,
      version: "0.3.27",
      target: "aarch64-apple-darwin",
    });
    assert.equal(map.schema_version, 1);
    assert.equal(map.kind, "proliferate.candidate-build");
    assert.equal(map.source_sha, SHA);
    assert.equal(map.artifacts.length, 1);
    assert.equal(map.artifacts[0].artifact_id, "anyharness/aarch64-apple-darwin");
    assert.equal(map.artifacts[0].version, "0.3.27");
    assert.equal(map.artifacts[0].sha256, sha256);
    assert.equal(map.artifacts[0].locator.kind, "local_file");
    assert.equal(map.artifacts[0].locator.path, path.resolve(binaryPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects a missing binary, malformed SHA, and unsafe target", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "assemble-map-"));
  try {
    const { binaryPath } = tempBinary(dir);
    assert.throws(() => assembleCandidateBuildMap({ binaryPath: path.join(dir, "missing") }));
    assert.throws(() =>
      assembleCandidateBuildMap({ binaryPath, sourceSha: "abc", version: "1", target: "t" }),
    );
    assert.throws(() =>
      assembleCandidateBuildMap({ binaryPath, sourceSha: SHA, version: "1", target: "bad target!" }),
    );
    assert.throws(() =>
      assembleCandidateBuildMap({ binaryPath, sourceSha: SHA, version: "", target: "x86_64-unknown-linux-gnu" }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI writes the map file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "assemble-map-cli-"));
  try {
    const { binaryPath, sha256 } = tempBinary(dir);
    const outputPath = path.join(dir, "out", "candidate-build.json");
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "assemble-candidate-build-map.mjs",
    );
    execFileSync(process.execPath, [
      script,
      "--binary",
      binaryPath,
      "--output",
      outputPath,
      "--source-sha",
      SHA,
      "--version",
      "9.9.9",
      "--target",
      "x86_64-unknown-linux-gnu",
    ]);
    const map = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(map.artifacts[0].sha256, sha256);
    assert.equal(map.artifacts[0].version, "9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects an artifact prefix that would assemble an invalid artifact id (CBH-006)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "assemble-map-"));
  try {
    const { binaryPath } = tempBinary(dir);
    assert.throws(() =>
      assembleCandidateBuildMap({
        binaryPath,
        sourceSha: SHA,
        version: "1",
        target: "x86_64-unknown-linux-gnu",
        artifactPrefix: "../escape",
      }),
    );
    assert.throws(() =>
      assembleCandidateBuildMap({
        binaryPath,
        sourceSha: SHA,
        version: "1",
        target: "x86_64-unknown-linux-gnu",
        artifactPrefix: "x".repeat(130),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
