import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  allocateCloudWorldSubdomain,
  buildCloudMuslBinaries,
  buildCloudQualificationCandidates,
  buildDesktopRendererArchiveForCloud,
  buildServerArchiveAmd64,
  materializeCredentialHelperArtifact,
} from "./build-cloud-qualification-candidates.mjs";

const SHA = "c".repeat(40);

/** Records every invocation and never shells out for real; each build step
 * materializes its expected output file with deterministic fake bytes so the
 * downstream SHA-256 hashing has real bytes to hash. Fully offline. */
function fakeExecFactory() {
  const calls = [];
  const exec = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "cargo") {
      const targetDir = options.env.CARGO_TARGET_DIR;
      const releaseDir = path.join(targetDir, "x86_64-unknown-linux-musl", "release");
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(path.join(releaseDir, "anyharness"), "fake-anyharness-musl-bytes");
      writeFileSync(path.join(releaseDir, "proliferate-worker"), "fake-worker-musl-bytes");
      writeFileSync(path.join(releaseDir, "proliferate-supervisor"), "fake-supervisor-musl-bytes");
      return "";
    }
    if (command === "docker" && args[0] === "buildx") {
      return "";
    }
    if (command === "docker" && args[0] === "save") {
      const outputIndex = args.indexOf("-o");
      writeFileSync(args[outputIndex + 1], "fake-docker-save-bytes");
      return "";
    }
    if (command === "pnpm") {
      return "";
    }
    if (command === "tar") {
      const outputPath = args[1];
      writeFileSync(outputPath, "fake-renderer-archive-bytes");
      return "";
    }
    throw new Error(`fakeExec: unexpected command "${command}" ${JSON.stringify(args)}`);
  };
  return { exec, calls };
}

test("allocateCloudWorldSubdomain uses the bare run label for the trivial shard '1'", () => {
  const { subdomain, apiBaseUrl } = allocateCloudWorldSubdomain({ runId: "ql-Pablo-1", shardId: "1", attemptSuffix: "abcd" });
  assert.equal(subdomain, "ql-pablo-1-abcd.qualification.proliferate.com");
  assert.equal(apiBaseUrl, "https://ql-pablo-1-abcd.qualification.proliferate.com");
});

test("allocateCloudWorldSubdomain folds in a non-trivial shard id so shards never collide", () => {
  const { subdomain } = allocateCloudWorldSubdomain({ runId: "run1", shardId: "2", attemptSuffix: "abcd" });
  assert.equal(subdomain, "run1-2-abcd.qualification.proliferate.com");
});

test("allocateCloudWorldSubdomain sanitizes unsafe characters into DNS-safe labels", () => {
  const { subdomain } = allocateCloudWorldSubdomain({ runId: "Run_ABC.123", shardId: "1", attemptSuffix: "abcd" });
  assert.equal(subdomain, "run-abc-123-abcd.qualification.proliferate.com");
});

test("allocateCloudWorldSubdomain respects a custom zone domain", () => {
  const { subdomain } = allocateCloudWorldSubdomain({ runId: "run1", shardId: "1", zoneDomain: "example.com", attemptSuffix: "abcd" });
  assert.equal(subdomain, "run1-abcd.example.com");
});

test("buildCloudMuslBinaries shells to cargo zigbuild with the fixed musl target and stamps version/sha", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-musl-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const outputDir = path.join(dir, "artifacts");
    const targetDir = path.join(dir, "cargo-target");
    const binaries = buildCloudMuslBinaries({ outputDir, version: "0.3.28", sourceSha: SHA, targetDir, exec });
    assert.ok(existsSync(binaries.anyharness));
    assert.ok(existsSync(binaries.worker));
    assert.ok(existsSync(binaries.supervisor));
    assert.equal(calls[0].command, "cargo");
    assert.deepEqual(calls[0].args, [
      "zigbuild",
      "--release",
      "--target",
      "x86_64-unknown-linux-musl",
      "-p",
      "anyharness",
      "-p",
      "proliferate-worker",
      "-p",
      "proliferate-supervisor",
    ]);
    assert.equal(calls[0].options.env.PROLIFERATE_BUILD_VERSION, "0.3.28");
    assert.equal(calls[0].options.env.PROLIFERATE_BUILD_SHA, SHA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildCloudMuslBinaries fails when cargo does not produce an expected binary", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-musl-missing-"));
  try {
    const exec = () => "";
    assert.throws(() =>
      buildCloudMuslBinaries({
        outputDir: path.join(dir, "artifacts"),
        version: "0.3.28",
        sourceSha: SHA,
        targetDir: path.join(dir, "cargo-target"),
        exec,
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("materializeCredentialHelperArtifact copies the checked-in script and marks it executable", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-cred-helper-"));
  try {
    const sourcePath = path.join(dir, "proliferate-git-credential-helper");
    writeFileSync(sourcePath, "#!/bin/sh\necho fake-helper\n");
    const outputPath = materializeCredentialHelperArtifact({ outputDir: path.join(dir, "artifacts"), sourcePath });
    assert.ok(existsSync(outputPath));
    assert.equal(readFileSync(outputPath, "utf8"), "#!/bin/sh\necho fake-helper\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("materializeCredentialHelperArtifact fails when the source script is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-cred-helper-missing-"));
  try {
    assert.throws(() =>
      materializeCredentialHelperArtifact({
        outputDir: path.join(dir, "artifacts"),
        sourcePath: path.join(dir, "does-not-exist"),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildServerArchiveAmd64 always builds for linux/amd64 regardless of host platform", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-server-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const outputPath = path.join(dir, "server.tar");
    const tag = buildServerArchiveAmd64({ outputPath, version: "0.3.28", exec });
    assert.equal(tag, "proliferate-server-qualification-cloud:0.3.28");
    assert.ok(existsSync(outputPath));
    assert.equal(calls[0].command, "docker");
    assert.deepEqual(calls[0].args.slice(0, 4), ["buildx", "build", "--platform", "linux/amd64"]);
    assert.ok(calls[0].args.includes("--load"));
    assert.equal(calls[1].command, "docker");
    assert.equal(calls[1].args[0], "save");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDesktopRendererArchiveForCloud bakes only VITE_PROLIFERATE_API_BASE_URL (no dev anyharness URL)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-renderer-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const distDir = path.join(dir, "apps", "desktop", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    const outputPath = path.join(dir, "artifacts", "renderer.tar.gz");
    buildDesktopRendererArchiveForCloud({
      outputPath,
      apiBaseUrl: "https://run1.qualification.proliferate.com",
      distDir,
      exec,
    });
    assert.ok(existsSync(outputPath));
    const pnpmCall = calls.find((call) => call.command === "pnpm");
    assert.deepEqual(pnpmCall.args, ["--filter", "proliferate", "build"]);
    assert.equal(pnpmCall.options.env.VITE_PROLIFERATE_API_BASE_URL, "https://run1.qualification.proliferate.com");
    assert.equal(pnpmCall.options.env.VITE_ANYHARNESS_DEV_URL, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildCloudQualificationCandidates: full offline orchestration produces the six-artifact map and subdomain sidecar", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-cloud-full-"));
  try {
    const { exec } = fakeExecFactory();
    const distDir = path.join(dir, "desktop-dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    const credentialHelperSourcePath = path.join(dir, "proliferate-git-credential-helper");
    writeFileSync(credentialHelperSourcePath, "#!/bin/sh\n");
    const runDir = path.join(dir, "run");

    const summary = await buildCloudQualificationCandidates(
      {
        runId: "run-abc123",
        shardId: "1",
        runDir,
        sourceSha: SHA,
        version: "0.3.28",
        desktopDistDir: distDir,
        credentialHelperSourcePath,
        attemptSuffix: "abcd",
      },
      { exec, log: () => {} },
    );

    assert.equal(summary.run_id, "run-abc123");
    assert.equal(summary.shard_id, "1");
    assert.equal(summary.subdomain, "run-abc123-abcd.qualification.proliferate.com");
    assert.equal(summary.urls.api_base_url, "https://run-abc123-abcd.qualification.proliferate.com");
    assert.ok(existsSync(summary.candidate_build_map));
    assert.ok(existsSync(summary.subdomain_file));

    const map = JSON.parse(readFileSync(summary.candidate_build_map, "utf8"));
    assert.equal(map.schema_version, 1);
    assert.equal(map.kind, "proliferate.candidate-build");
    assert.equal(map.source_sha, SHA);
    const ids = map.artifacts.map((artifact) => artifact.artifact_id).sort();
    assert.deepEqual(ids, [
      "anyharness/x86_64-unknown-linux-musl",
      "credential-helper/x86_64-unknown-linux-musl",
      "desktop-renderer/browser",
      "server/linux/amd64",
      "supervisor/x86_64-unknown-linux-musl",
      "worker/x86_64-unknown-linux-musl",
    ]);
    for (const artifact of map.artifacts) {
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.equal(artifact.locator.kind, "local_file");
    }

    const sidecar = JSON.parse(readFileSync(summary.subdomain_file, "utf8"));
    assert.equal(sidecar.subdomain, "run-abc123-abcd.qualification.proliferate.com");
    assert.equal(sidecar.apiBaseUrl, "https://run-abc123-abcd.qualification.proliferate.com");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildCloudQualificationCandidates rejects an unsafe run-id and a missing run-dir", async () => {
  const { exec } = fakeExecFactory();
  await assert.rejects(
    buildCloudQualificationCandidates({ runId: "../escape", shardId: "1", runDir: "/tmp/x" }, { exec }),
  );
  await assert.rejects(
    buildCloudQualificationCandidates({ runId: "run1", shardId: "1", runDir: undefined }, { exec }),
  );
});
