import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  allocateLocalWorldPorts,
  buildAnyharnessBinary,
  buildDesktopRendererArchive,
  buildLocalQualificationCandidates,
  buildServerArchive,
  resolveDockerPlatform,
  resolveRustHostTarget,
} from "./build-local-qualification-candidates.mjs";

const SHA = "b".repeat(40);

/** Records every invocation and never shells out for real; each build step
 * materializes its expected output file with deterministic fake bytes so the
 * downstream SHA-256 hashing has real bytes to hash. Fully offline. */
function fakeExecFactory() {
  const calls = [];
  const exec = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "rustc") {
      return "host: x86_64-unknown-linux-gnu\n";
    }
    if (command === "docker" && args[0] === "version") {
      return "linux/amd64\n";
    }
    if (command === "docker" && args[0] === "save") {
      const outputIndex = args.indexOf("-o");
      writeFileSync(args[outputIndex + 1], "fake-docker-save-bytes");
      return "";
    }
    if (command === "docker" && args[0] === "build") {
      return "";
    }
    if (command === "cargo") {
      const targetDir = options.env.CARGO_TARGET_DIR;
      mkdirSync(path.join(targetDir, "release"), { recursive: true });
      writeFileSync(path.join(targetDir, "release", "anyharness"), "fake-anyharness-binary-bytes");
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

function fakeAllocatePorts() {
  let next = 40000;
  return async () => ({
    server: next++,
    postgres: next++,
    redis: next++,
    anyharness: next++,
    renderer: next++,
  });
}

test("allocateLocalWorldPorts returns five distinct ports from the injected allocator", async () => {
  let counter = 50000;
  const ports = await allocateLocalWorldPorts({ ephemeralPort: async () => counter++ });
  const values = Object.values(ports);
  assert.equal(values.length, 5);
  assert.equal(new Set(values).size, 5);
  assert.deepEqual(Object.keys(ports).sort(), ["anyharness", "postgres", "redis", "renderer", "server"]);
});

test("resolveRustHostTarget and resolveDockerPlatform go through the injected exec seam", () => {
  const { exec, calls } = fakeExecFactory();
  assert.equal(resolveRustHostTarget(exec), "x86_64-unknown-linux-gnu");
  assert.equal(resolveDockerPlatform(exec), "linux/amd64");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "rustc");
  assert.equal(calls[1].command, "docker");
});

test("resolveDockerPlatform rejects an unsafe/unparseable platform string", () => {
  assert.throws(() => resolveDockerPlatform(() => "not a platform!"));
});

test("buildServerArchive shells out to docker build+save and requires the archive to exist", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-server-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const outputPath = path.join(dir, "server.tar");
    const tag = buildServerArchive({ outputPath, version: "0.3.28", exec });
    assert.equal(tag, "proliferate-server-qualification:0.3.28");
    assert.ok(existsSync(outputPath));
    assert.equal(calls[0].command, "docker");
    assert.equal(calls[0].args[0], "build");
    assert.ok(calls[0].args.includes("--build-arg"));
    assert.ok(calls[0].args.includes("SERVER_VERSION=0.3.28"));
    assert.equal(calls[1].command, "docker");
    assert.equal(calls[1].args[0], "save");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildAnyharnessBinary stamps version/sha env and materializes an executable copy", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-anyharness-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const targetDir = path.join(dir, "cargo-target");
    const outputPath = path.join(dir, "artifacts", "anyharness");
    buildAnyharnessBinary({ outputPath, version: "0.3.28", sourceSha: SHA, targetDir, exec });
    assert.ok(existsSync(outputPath));
    assert.equal(readFileSync(outputPath, "utf8"), "fake-anyharness-binary-bytes");
    assert.equal(calls[0].command, "cargo");
    assert.equal(calls[0].options.env.CARGO_TARGET_DIR, targetDir);
    assert.equal(calls[0].options.env.PROLIFERATE_BUILD_VERSION, "0.3.28");
    assert.equal(calls[0].options.env.PROLIFERATE_BUILD_SHA, SHA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildAnyharnessBinary fails when cargo does not produce the binary", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-anyharness-missing-"));
  try {
    const exec = () => "";
    assert.throws(() =>
      buildAnyharnessBinary({
        outputPath: path.join(dir, "anyharness"),
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

test("buildDesktopRendererArchive bakes VITE_* URLs and archives the dist directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-renderer-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const distDir = path.join(dir, "apps", "desktop", "dist");
    mkdirSync(distDir, { recursive: true });
    // The pnpm build step is faked (no-op), so pre-seed the dist output the
    // real build would have produced.
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    const outputPath = path.join(dir, "artifacts", "renderer.tar.gz");
    buildDesktopRendererArchive({
      outputPath,
      apiBaseUrl: "http://127.0.0.1:40001",
      anyharnessDevUrl: "http://127.0.0.1:40004",
      distDir,
      exec,
    });
    assert.ok(existsSync(outputPath));
    const pnpmCall = calls.find((call) => call.command === "pnpm");
    assert.equal(pnpmCall.options.env.VITE_PROLIFERATE_API_BASE_URL, "http://127.0.0.1:40001");
    assert.equal(pnpmCall.options.env.VITE_ANYHARNESS_DEV_URL, "http://127.0.0.1:40004");
    const tarCall = calls.find((call) => call.command === "tar");
    assert.equal(tarCall.args[1], outputPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDesktopRendererArchive fails when the dist directory was not produced", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-renderer-missing-"));
  try {
    const { exec } = fakeExecFactory();
    assert.throws(() =>
      buildDesktopRendererArchive({
        outputPath: path.join(dir, "renderer.tar.gz"),
        apiBaseUrl: "http://127.0.0.1:1",
        anyharnessDevUrl: "http://127.0.0.1:2",
        distDir: path.join(dir, "nonexistent-dist"),
        exec,
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildLocalQualificationCandidates: full offline orchestration produces a valid three-artifact map", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-candidates-full-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const distDir = path.join(dir, "desktop-dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    const runDir = path.join(dir, "run");

    const summary = await buildLocalQualificationCandidates(
      {
        runId: "run-abc123",
        shardId: "shard-1",
        runDir,
        sourceSha: SHA,
        version: "0.3.28",
        target: "aarch64-apple-darwin",
        dockerPlatform: "linux/arm64",
        desktopDistDir: distDir,
      },
      { exec, allocatePorts: fakeAllocatePorts(), log: () => {} },
    );

    assert.equal(summary.run_id, "run-abc123");
    assert.equal(summary.shard_id, "shard-1");
    assert.ok(existsSync(summary.candidate_build_map));
    assert.ok(existsSync(summary.ports_file));

    const map = JSON.parse(readFileSync(summary.candidate_build_map, "utf8"));
    assert.equal(map.schema_version, 1);
    assert.equal(map.kind, "proliferate.candidate-build");
    assert.equal(map.source_sha, SHA);
    assert.equal(map.artifacts.length, 3);
    const ids = map.artifacts.map((artifact) => artifact.artifact_id).sort();
    assert.deepEqual(ids, ["anyharness/aarch64-apple-darwin", "desktop-renderer/browser", "server/linux/arm64"]);
    for (const artifact of map.artifacts) {
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.equal(artifact.locator.kind, "local_file");
    }

    const ports = JSON.parse(readFileSync(summary.ports_file, "utf8"));
    assert.deepEqual(Object.keys(ports).sort(), ["anyharness", "postgres", "redis", "renderer", "server"]);
    assert.equal(summary.urls.api_base_url, `http://127.0.0.1:${ports.server}`);
    assert.equal(summary.urls.anyharness_dev_url, `http://127.0.0.1:${ports.anyharness}`);

    // Never shelled out to real rustc/docker-version resolution — target and
    // docker platform were supplied explicitly.
    assert.equal(
      calls.some((call) => call.command === "rustc"),
      false,
    );
    assert.equal(
      calls.some((call) => call.command === "docker" && call.args[0] === "version"),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildLocalQualificationCandidates rejects unsafe run-id/shard-id and a missing run-dir", async () => {
  const { exec } = fakeExecFactory();
  await assert.rejects(() =>
    buildLocalQualificationCandidates(
      { runId: "../escape", shardId: "1", runDir: "/tmp/x", sourceSha: SHA, version: "1" },
      { exec, allocatePorts: fakeAllocatePorts() },
    ),
  );
  await assert.rejects(() =>
    buildLocalQualificationCandidates(
      { runId: "run-1", shardId: "1", sourceSha: SHA, version: "1" },
      { exec, allocatePorts: fakeAllocatePorts() },
    ),
  );
});
