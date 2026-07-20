import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  allocateSecondLocalWorldPorts,
  appendSelfHostRuntimeChecksum,
  buildSelfHostDeployBundle,
  buildSelfHostQualificationCandidates,
  buildSelfHostRuntimeArchive,
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
    if (command === "cross") {
      const targetDir = options.env.CARGO_TARGET_DIR;
      const target = args[args.indexOf("--target") + 1];
      const releaseDir = path.join(targetDir, target, "release");
      mkdirSync(releaseDir, { recursive: true });
      for (const binary of ["anyharness", "proliferate-worker", "proliferate-supervisor"]) {
        writeFileSync(path.join(releaseDir, binary), `fake-${binary}-arm64-bytes`);
      }
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
      return args.map((name, index) => `${String(index + 1).repeat(64).slice(0, 64)}  ${name}\n`).join("");
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

test("buildSelfHostDeployBundle mirrors server-ci (drop CI/runtime files, VERSION, root-owned tar, sibling SHA256SUMS)", () => {
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
    // Drops the CI-only trees and host-local bootstrap progress.
    const rmTargets = calls.filter((c) => c.command === "rm").map((c) => c.args[1]);
    assert.ok(rmTargets.some((t) => t.endsWith("/smoke")));
    assert.ok(rmTargets.some((t) => t.endsWith("/tests")));
    assert.ok(rmTargets.some((t) => t.endsWith("/.bootstrap-progress.log")));
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

test("buildSelfHostRuntimeArchive builds the exact arm64 trio and binds it into the shared SHA256SUMS", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-runtime-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const artifactsDir = path.join(dir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const outputPath = path.join(artifactsDir, "anyharness-aarch64-unknown-linux-musl.tar.gz");
    const sumsOutputPath = path.join(artifactsDir, "self-hosted-assets.SHA256SUMS");
    writeFileSync(sumsOutputPath, `${"a".repeat(64)}  proliferate-deploy.tar.gz\n`);

    buildSelfHostRuntimeArchive({
      outputPath,
      version: "0.3.28",
      sourceSha: SHA,
      targetDir: path.join(dir, "cargo-target"),
      exec,
    });
    appendSelfHostRuntimeChecksum({ runtimePath: outputPath, sumsOutputPath, exec });

    const crossCall = calls.find((call) => call.command === "cross");
    assert.ok(crossCall);
    assert.deepEqual(crossCall.args.slice(0, 4), ["build", "--release", "--target", "aarch64-unknown-linux-musl"]);
    assert.equal(crossCall.options.env.PROLIFERATE_BUILD_VERSION, "0.3.28");
    assert.equal(crossCall.options.env.PROLIFERATE_BUILD_SHA, SHA);
    const tarCall = calls.find((call) => call.command === "tar");
    assert.ok(tarCall.args.includes("anyharness"));
    assert.ok(tarCall.args.includes("proliferate-worker"));
    assert.ok(tarCall.args.includes("proliferate-supervisor"));
    assert.ok(tarCall.args.includes("--owner=0"));
    assert.match(readFileSync(sumsOutputPath, "utf8"), /anyharness-aarch64-unknown-linux-musl\.tar\.gz/);
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

test("buildSelfHostQualificationCandidates: arm64 CFN build adds the exact runtime candidate and checksum", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-arm64-"));
  try {
    const { exec, calls } = fakeExecFactory();
    const deployDir = path.join(dir, "server", "deploy");
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(path.join(deployDir, "install.sh"), "#!/usr/bin/env bash\n");
    const distDir = path.join(dir, "desktop-dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");

    const summary = await buildSelfHostQualificationCandidates(
      {
        runId: "qs-run-arm64",
        shardId: "1",
        runDir: path.join(dir, "run"),
        sourceSha: SHA,
        version: "0.3.28",
        target: "x86_64-unknown-linux-gnu",
        platform: "linux/arm64",
        deployDir,
        desktopDistDir: distDir,
      },
      { exec, allocatePorts: fakeAllocatePorts(), log: () => {} },
    );

    assert.ok(summary.runtime_bundle);
    const map = JSON.parse(readFileSync(summary.candidate_build_map, "utf8"));
    assert.equal(map.artifacts.length, 5);
    assert.ok(map.artifacts.some((artifact) => artifact.artifact_id === "selfhost-runtime/linux/arm64"));
    assert.ok(calls.some((call) => call.command === "cross"));
    const sums = readFileSync(summary.bundle_sha256sums, "utf8");
    assert.match(sums, /proliferate-deploy\.tar\.gz/);
    assert.match(sums, /anyharness-aarch64-unknown-linux-musl\.tar\.gz/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSelfHostQualificationCandidates bakes the supplied --api-base-url into the web renderer (and falls back to a non-hosted local origin without one)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-apibase-"));
  try {
    const deployDir = path.join(dir, "server", "deploy");
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(path.join(deployDir, "install.sh"), "#!/usr/bin/env bash\n");
    const distDir = path.join(dir, "desktop-dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<html></html>");

    const runWith = async (apiBaseUrl, runDirName) => {
      const { exec, calls } = fakeExecFactory();
      await buildSelfHostQualificationCandidates(
        {
          runId: "qs-run-abc123",
          shardId: "1",
          runDir: path.join(dir, runDirName),
          sourceSha: SHA,
          version: "0.3.28",
          target: "aarch64-apple-darwin",
          platform: "linux/amd64",
          deployDir,
          desktopDistDir: distDir,
          apiBaseUrl,
        },
        { exec, allocatePorts: fakeAllocatePorts(), log: () => {} },
      );
      const rendererBuild = calls.find(
        (c) => c.command === "pnpm" && c.args.includes("build") && c.options?.env?.VITE_PROLIFERATE_API_BASE_URL,
      );
      return rendererBuild.options.env.VITE_PROLIFERATE_API_BASE_URL;
    };

    // Supplied run URL is baked verbatim.
    assert.equal(
      await runWith("https://sh-qs-run-abc123-1-deadbeef.qualification.proliferate.com", "run-a"),
      "https://sh-qs-run-abc123-1-deadbeef.qualification.proliferate.com",
    );
    // Omitted → falls back to a dead LOCAL origin (never a hosted API).
    const fallback = await runWith(undefined, "run-b");
    assert.match(fallback, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allocateSecondLocalWorldPorts returns a set disjoint from the first when the allocator is naturally distinct", async () => {
  let next = 50000;
  const alloc = async () => ({
    server: next++,
    postgres: next++,
    redis: next++,
    anyharness: next++,
    renderer: next++,
  });
  const first = await alloc();
  const second = await allocateSecondLocalWorldPorts(alloc, first);
  const firstValues = new Set(Object.values(first));
  for (const port of Object.values(second)) {
    assert.equal(firstValues.has(port), false);
  }
});

test("allocateSecondLocalWorldPorts retries when the allocator returns an overlapping set", async () => {
  const first = { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 };
  let call = 0;
  const alloc = async () => {
    call += 1;
    if (call === 1) {
      // Overlaps first.server (1).
      return { server: 1, postgres: 20, redis: 21, anyharness: 22, renderer: 23 };
    }
    return { server: 30, postgres: 31, redis: 32, anyharness: 33, renderer: 34 };
  };
  const second = await allocateSecondLocalWorldPorts(alloc, first);
  assert.equal(call, 2);
  assert.deepEqual(second, { server: 30, postgres: 31, redis: 32, anyharness: 33, renderer: 34 });
});

test("allocateSecondLocalWorldPorts fails closed after exhausting retries on a persistently overlapping allocator", async () => {
  const first = { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 };
  const alloc = async () => ({ ...first });
  await assert.rejects(() => allocateSecondLocalWorldPorts(alloc, first, { maxAttempts: 3 }), /non-overlapping/);
});

test("buildSelfHostQualificationCandidates: --second-ports off by default writes no sidecar (output unchanged from before the flag existed)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-noports-"));
  try {
    const { exec } = fakeExecFactory();
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

    assert.equal(summary.second_ports_file, undefined);
    assert.equal(summary.second_ports, undefined);
    assert.equal(existsSync(path.join(runDir, "local-world-ports-b.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSelfHostQualificationCandidates: --second-ports writes a disjoint sidecar with the same LocalWorldPorts shape", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfhost-secondports-"));
  try {
    const { exec } = fakeExecFactory();
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
        secondPorts: true,
      },
      { exec, allocatePorts: fakeAllocatePorts(), log: () => {} },
    );

    assert.ok(existsSync(summary.ports_file));
    const secondPortsPath = path.join(runDir, "local-world-ports-b.json");
    assert.equal(summary.second_ports_file, secondPortsPath);
    assert.ok(existsSync(secondPortsPath));

    const first = JSON.parse(readFileSync(summary.ports_file, "utf8"));
    const second = JSON.parse(readFileSync(secondPortsPath, "utf8"));
    assert.deepEqual(second, summary.second_ports);
    // Same LocalWorldPorts shape (server/postgres/redis/anyharness/renderer)
    // as the primary local-world-ports.json sidecar.
    assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
    // Non-overlapping with the first set.
    const firstValues = new Set(Object.values(first));
    for (const port of Object.values(second)) {
      assert.equal(firstValues.has(port), false);
    }
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
