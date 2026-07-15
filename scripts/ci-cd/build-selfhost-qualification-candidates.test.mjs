import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildSelfHostDeployBundle,
  buildSelfHostQualificationCandidates,
  buildServerImageArchive,
} from "./build-selfhost-qualification-candidates.mjs";

const SHA = "b".repeat(40);

/** Records every invocation and never shells out for real; each side-effecting
 * step materializes its expected output with deterministic fake bytes so the
 * downstream SHA-256 hashing has real bytes to hash. Fully offline. */
function fakeExecFactory() {
  const calls = [];
  const exec = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "rustc") {
      return "host: x86_64-unknown-linux-gnu\n";
    }
    if (command === "docker" && args[0] === "buildx") {
      return "";
    }
    if (command === "docker" && args[0] === "save") {
      const outputIndex = args.indexOf("-o");
      writeFileSync(args[outputIndex + 1], "fake-docker-save-bytes");
      return "";
    }
    if (command === "cp" || command === "rm") {
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
      // Both the bundle build (`czf <out> ...`) and the renderer build
      // (`-czf <out> ...`) put the output path at args[1].
      writeFileSync(args[1], "fake-tar-bytes");
      return "";
    }
    if (command === "sha256sum") {
      return `${"d".repeat(64)}  ${args[0]}\n`;
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

test("buildServerImageArchive uses buildx --load for the box platform and docker-saves the candidate tag", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-server-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const outputPath = path.join(dir, "server-image.tar");
    const result = buildServerImageArchive({ outputPath, version: "0.3.28", platform: "linux/amd64", exec });
    assert.equal(result.repo, "proliferate-server-qualification");
    assert.equal(result.tag, "proliferate-server-qualification:0.3.28");
    assert.ok(existsSync(outputPath));
    const buildCall = calls.find((c) => c.command === "docker" && c.args[0] === "buildx");
    assert.ok(buildCall.args.includes("--platform"));
    assert.ok(buildCall.args.includes("linux/amd64"));
    assert.ok(buildCall.args.includes("--load"));
    assert.ok(buildCall.args.includes("SERVER_VERSION=0.3.28"));
    // Never rolls stable/latest — the tag is the candidate version.
    assert.ok(buildCall.args.includes("proliferate-server-qualification:0.3.28"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSelfHostDeployBundle mirrors the server-ci release bundle build (drop smoke/tests, VERSION, root-owned tar, sibling SHA256SUMS)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-bundle-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const deployDir = path.join(dir, "server", "deploy");
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(path.join(deployDir, "install.sh"), "#!/usr/bin/env bash\n");
    const bundleOutputPath = path.join(dir, "artifacts", "proliferate-deploy.tar.gz");
    const sumsOutputPath = path.join(dir, "artifacts", "self-hosted-assets.SHA256SUMS");

    buildSelfHostDeployBundle({ bundleOutputPath, sumsOutputPath, version: "0.3.28", deployDir, exec });

    assert.ok(existsSync(bundleOutputPath));
    assert.ok(existsSync(sumsOutputPath));

    // cp -R server/deploy/. <stage>/
    const cpCall = calls.find((c) => c.command === "cp");
    assert.deepEqual(cpCall.args.slice(0, 2), ["-R", `${deployDir}/.`]);
    // Drops the CI-only trees.
    const rmTargets = calls.filter((c) => c.command === "rm").map((c) => c.args[1]);
    assert.ok(rmTargets.some((t) => t.endsWith("/smoke")));
    assert.ok(rmTargets.some((t) => t.endsWith("/tests")));
    // Reproducible root-owned archive (server-ci parity).
    const tarCall = calls.find((c) => c.command === "tar");
    assert.ok(tarCall.args.includes("--owner=0"));
    assert.ok(tarCall.args.includes("--group=0"));
    assert.ok(tarCall.args.includes("--numeric-owner"));
    assert.ok(tarCall.args.includes("proliferate-deploy"));
    // Bare-name checksum computed in the artifacts dir so `sha256sum -c` in the
    // installer resolves the sibling filename.
    const sumsCall = calls.find((c) => c.command === "sha256sum");
    assert.deepEqual(sumsCall.args, ["proliferate-deploy.tar.gz"]);
    assert.equal(sumsCall.options.cwd, path.dirname(bundleOutputPath));
    assert.match(readFileSync(sumsOutputPath, "utf8"), /proliferate-deploy\.tar\.gz/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSelfHostQualificationCandidates: full offline orchestration produces a valid four-artifact map", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-full-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const deployDir = path.join(dir, "server", "deploy");
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(path.join(deployDir, "install.sh"), "#!/usr/bin/env bash\n");
    const distDir = path.join(dir, "desktop-dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    const runDir = path.join(dir, "run");

    const summary = await buildSelfHostQualificationCandidates(
      {
        runId: "qs-run-abc123",
        shardId: "1",
        runDir,
        sourceSha: SHA,
        version: "0.3.28",
        target: "aarch64-apple-darwin",
        platform: "linux/amd64",
        deployDir,
        desktopDistDir: distDir,
      },
      { exec, allocatePorts: fakeAllocatePorts(), log: () => {} },
    );

    assert.equal(summary.run_id, "qs-run-abc123");
    assert.equal(summary.platform, "linux/amd64");
    assert.ok(existsSync(summary.candidate_build_map));
    assert.ok(existsSync(summary.bundle_sha256sums));
    assert.ok(existsSync(summary.ports_file));
    // The checksum sibling sits next to the bundle inside the map's artifacts
    // dir (the world derives its path from the bundle locator).
    assert.equal(path.basename(summary.bundle_sha256sums), "self-hosted-assets.SHA256SUMS");

    const map = JSON.parse(readFileSync(summary.candidate_build_map, "utf8"));
    assert.equal(map.schema_version, 1);
    assert.equal(map.source_sha, SHA);
    assert.equal(map.artifacts.length, 4);
    const ids = map.artifacts.map((a) => a.artifact_id).sort();
    assert.deepEqual(ids, [
      "anyharness/aarch64-apple-darwin",
      "desktop-renderer/browser",
      "selfhost-bundle/linux/amd64",
      "server/linux/amd64",
    ]);
    for (const artifact of map.artifacts) {
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.equal(artifact.locator.kind, "local_file");
    }
    // The bundle sums sibling lives beside the bundle locator, as the world
    // expects (dirname(bundle)/self-hosted-assets.SHA256SUMS).
    const bundle = map.artifacts.find((a) => a.artifact_id === "selfhost-bundle/linux/amd64");
    assert.equal(
      path.join(path.dirname(bundle.locator.path), "self-hosted-assets.SHA256SUMS"),
      summary.bundle_sha256sums,
    );

    // Never shelled out to real rustc (target supplied explicitly).
    assert.equal(calls.some((c) => c.command === "rustc"), false);
    // The server image was built via buildx --load for the box platform.
    assert.ok(calls.some((c) => c.command === "docker" && c.args[0] === "buildx" && c.args.includes("linux/amd64")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSelfHostQualificationCandidates rejects unsafe ids, a missing run-dir, and a bad platform", async () => {
  const { exec } = fakeExecFactory();
  await assert.rejects(() =>
    buildSelfHostQualificationCandidates(
      { runId: "../escape", shardId: "1", runDir: "/tmp/x", sourceSha: SHA, version: "1" },
      { exec, allocatePorts: fakeAllocatePorts() },
    ),
  );
  await assert.rejects(() =>
    buildSelfHostQualificationCandidates(
      { runId: "qs-1", shardId: "1", sourceSha: SHA, version: "1" },
      { exec, allocatePorts: fakeAllocatePorts() },
    ),
  );
  await assert.rejects(
    () =>
      buildSelfHostQualificationCandidates(
        { runId: "qs-1", shardId: "1", runDir: "/tmp/x", sourceSha: SHA, version: "1", platform: "darwin/amd64" },
        { exec, allocatePorts: fakeAllocatePorts() },
      ),
    /--platform must be/,
  );
});
