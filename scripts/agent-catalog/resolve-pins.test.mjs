import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const resolver = join(sourceDir, "resolve-pins.mjs");

test("direct binaries use a matching versioned checksum manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-agent-pins-"));
  const requests = [];
  const checksum = "a".repeat(64);
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/latest") {
      response.end("9.9.9\n");
      return;
    }
    if (request.url === "/9.9.9/manifest.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        version: "9.9.9",
        platforms: { "darwin-arm64": { checksum, size: 123_456_789 } },
      }));
      return;
    }
    response.statusCode = 500;
    response.end("binary should not be downloaded");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const catalogPath = join(root, "catalog.json");
  const registryPath = join(root, "registry.json");
  writeFileSync(catalogPath, JSON.stringify({
    agents: [{
      kind: "claude",
      harness: {
        native: { version: "1.0.0", source: { kind: "binary", targets: {} } },
        agentProcess: { version: "0.44.0" },
      },
    }],
  }));
  writeFileSync(registryPath, JSON.stringify({
    agents: [{
      kind: "claude",
      native: {
        install: {
          kind: "direct_binary",
          latestVersionUrl: `http://127.0.0.1:${port}/latest`,
          binaryUrlTemplate: `http://127.0.0.1:${port}/{version}/{platform}/claude`,
          platformMap: { macos_arm64: "darwin-arm64" },
        },
      },
      agentProcess: {
        install: {
          kind: "managed_npm_package",
          package: "git+https://example.test/claude-agent-acp.git#abc123",
          executableRelpath: "node_modules/.bin/claude-agent-acp",
        },
      },
    }],
  }));

  try {
    const result = await run(process.execPath, [
      resolver,
      "--agent", "claude",
      "--platforms", "macos_arm64",
      "--catalog", catalogPath,
      "--registry", registryPath,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    assert.equal(catalog.agents[0].harness.native.version, "9.9.9");
    assert.equal(
      catalog.agents[0].harness.native.source.targets.macos_arm64.sha256,
      checksum,
    );
    assert.equal(
      catalog.agents[0].harness.native.source.targets.macos_arm64.downloadSizeBytes,
      123_456_789,
    );
    assert.deepEqual(requests, ["/latest", "/9.9.9/manifest.json"]);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry-backed archives use the registry's published checksum", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-registry-pins-"));
  const requests = [];
  const checksum = "b".repeat(64);
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/registry.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        agents: [{
          id: "opencode",
          version: "2.3.4",
          distribution: {
            binary: {
              "darwin-aarch64": {
                archive: `http://127.0.0.1:${server.address().port}/opencode.zip`,
                cmd: "./opencode",
                args: ["acp"],
                sha256: checksum,
                size: 4_200_000,
              },
            },
          },
        }],
      }));
      return;
    }
    response.statusCode = 500;
    response.end("archive should not be downloaded");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const catalogPath = join(root, "catalog.json");
  const registryPath = join(root, "registry.json");
  writeFileSync(catalogPath, JSON.stringify({
    agents: [{ kind: "opencode", harness: { agentProcess: { version: "1.0.0" } } }],
  }));
  writeFileSync(registryPath, JSON.stringify({
    agents: [{
      kind: "opencode",
      agentProcess: { install: { kind: "registry_backed", registryId: "opencode" } },
    }],
  }));

  try {
    const result = await run(process.execPath, [
      resolver,
      "--agent", "opencode",
      "--platforms", "macos_arm64",
      "--catalog", catalogPath,
      "--registry", registryPath,
    ], { ANYHARNESS_ACP_REGISTRY_URL: `http://127.0.0.1:${port}/registry.json` });
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    assert.equal(catalog.agents[0].harness.agentProcess.version, "2.3.4");
    assert.equal(
      catalog.agents[0].harness.agentProcess.source.targets.macos_arm64.sha256,
      checksum,
    );
    assert.equal(
      catalog.agents[0].harness.agentProcess.source.targets.macos_arm64.downloadSizeBytes,
      4_200_000,
    );
    assert.deepEqual(requests, ["/registry.json"]);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct_archive pins resolve onto the catalog archive source", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-direct-archive-"));
  const checksum = "c".repeat(64);
  const catalogPath = join(root, "catalog.json");
  const registryPath = join(root, "registry.json");
  writeFileSync(catalogPath, JSON.stringify({
    agents: [{ kind: "cursor", harness: { agentProcess: { version: "1.2.3" } } }],
  }));
  writeFileSync(registryPath, JSON.stringify({
    agents: [{
      kind: "cursor",
      agentProcess: {
        install: {
          kind: "direct_archive",
          platforms: {
            macos_arm64: {
              // A published 64-hex checksum is trusted as-is: no download.
              url: "https://downloads.test/cursor-macos-arm64.tar.gz",
              sha256: checksum,
              expectedBinary: "pkg/cursor-agent",
              size: 5_000_000,
            },
          },
          args: ["acp"],
        },
      },
    }],
  }));

  const result = await run(process.execPath, [
    resolver,
    "--agent", "cursor",
    "--platforms", "macos_arm64",
    "--catalog", catalogPath,
    "--registry", registryPath,
  ]);
  try {
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const source = catalog.agents[0].harness.agentProcess.source;
    assert.equal(source.kind, "archive");
    assert.equal(source.targets.macos_arm64.sha256, checksum);
    assert.equal(source.targets.macos_arm64.expectedBinary, "pkg/cursor-agent");
    assert.equal(source.targets.macos_arm64.downloadSizeBytes, 5_000_000);
    assert.deepEqual(source.args, ["acp"]);
    assert.equal(catalog.agents[0].harness.agentProcess.version, "1.2.3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("windows direct binaries resolve their per-platform artifact name", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-agent-pins-win-"));
  const requests = [];
  const checksum = "d".repeat(64);
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/1.0.0/manifest.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        version: "1.0.0",
        platforms: { "win32-x64": { binary: "claude.exe", checksum, size: 42 } },
      }));
      return;
    }
    response.statusCode = 500;
    response.end("binary should not be downloaded");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const catalogPath = join(root, "catalog.json");
  const registryPath = join(root, "registry.json");
  writeFileSync(catalogPath, JSON.stringify({
    agents: [{
      kind: "claude",
      harness: {
        native: { version: "1.0.0", source: { kind: "binary", targets: {} } },
        agentProcess: { version: "0.44.0" },
      },
    }],
  }));
  writeFileSync(registryPath, JSON.stringify({
    agents: [{
      kind: "claude",
      native: {
        install: {
          kind: "direct_binary",
          latestVersionUrl: `http://127.0.0.1:${port}/latest`,
          binaryUrlTemplate: `http://127.0.0.1:${port}/{version}/{platform}/{binary}`,
          platformMap: { windows_x64: "win32-x64" },
          binaryNameMap: { windows_x64: "claude.exe" },
        },
      },
      agentProcess: {
        install: {
          kind: "managed_npm_package",
          package: "git+https://example.test/claude-agent-acp.git#abc123",
          executableRelpath: "node_modules/.bin/claude-agent-acp",
        },
      },
    }],
  }));

  try {
    const result = await run(process.execPath, [
      resolver,
      "--agent", "claude",
      "--keep-versions",
      "--platforms", "windows_x64",
      "--catalog", catalogPath,
      "--registry", registryPath,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    // --keep-versions must not consult the latest-version channel at all.
    assert.deepEqual(requests, ["/1.0.0/manifest.json"]);
    assert.equal(catalog.agents[0].harness.native.version, "1.0.0");
    assert.equal(
      catalog.agents[0].harness.native.source.targets.windows_x64.url,
      `http://127.0.0.1:${port}/1.0.0/win32-x64/claude.exe`,
    );
    assert.equal(
      catalog.agents[0].harness.native.source.targets.windows_x64.sha256,
      checksum,
    );
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("--keep-versions refuses to adopt a newer ACP registry release", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolve-keep-versions-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      agents: [{
        id: "opencode",
        version: "2.0.0",
        distribution: {
          binary: {
            "darwin-aarch64": {
              archive: "https://downloads.test/opencode-2.0.0.zip",
              cmd: "./opencode",
              sha256: "e".repeat(64),
            },
          },
        },
      }],
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const pinned = {
    kind: "archive",
    targets: {
      macos_arm64: {
        url: "https://downloads.test/opencode-1.0.0.zip",
        sha256: "f".repeat(64),
        expectedBinary: "./opencode",
      },
    },
    args: [],
  };
  const catalogPath = join(root, "catalog.json");
  const registryPath = join(root, "registry.json");
  writeFileSync(catalogPath, JSON.stringify({
    agents: [{ kind: "opencode", harness: { agentProcess: { version: "1.0.0", source: pinned } } }],
  }));
  writeFileSync(registryPath, JSON.stringify({
    agents: [{
      kind: "opencode",
      agentProcess: { install: { kind: "registry_backed", registryId: "opencode" } },
    }],
  }));

  try {
    const result = await run(process.execPath, [
      resolver,
      "--agent", "opencode",
      "--keep-versions",
      "--catalog", catalogPath,
      "--registry", registryPath,
    ], { ANYHARNESS_ACP_REGISTRY_URL: `http://127.0.0.1:${port}/registry.json` });
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    assert.equal(catalog.agents[0].harness.agentProcess.version, "1.0.0");
    assert.deepEqual(catalog.agents[0].harness.agentProcess.source, pinned);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function run(command, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
