#!/usr/bin/env node
// The one local/Actions producer of the three exact local-world candidates
// (Prove One Real Local Workspace Turn — "Build order"):
//
//   choose run/profile identity and allocate non-conflicting ports
//   -> build Server image archive
//   -> build release AnyHarness
//   -> build the browser-rendered Desktop product with those API/runtime URLs
//   -> assemble one three-artifact candidate map
//
// `make qualification-local-workspace` and the release-e2e.yml manual job
// both call this same script — there is no second implementation of these
// build steps. Allocating ports and writing the candidate map is preparation,
// not product world startup: this script never starts a database, Server,
// AnyHarness, renderer, browser, actor, or scenario.
//
// Usage:
//   node scripts/ci-cd/build-local-qualification-candidates.mjs \
//     --run-id <run-id> --shard-id <shard-id> --run-dir <path> \
//     [--source-sha <40-hex>] [--version <v>] [--target <rust-triple>]
//
// Prints one line of machine-readable JSON to stdout on success:
//   {"run_id":...,"shard_id":...,"candidate_build_map":"<path>",
//    "ports":{"server":N,"postgres":N,"redis":N,"anyharness":N,"renderer":N},
//    "urls":{"api_base_url":"...","anyharness_dev_url":"..."}}

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assembleCandidateBuildMapFromArtifacts, gitHeadSha, repositoryVersion } from "./assemble-candidate-build-map.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Default exec seam: real execFileSync. The unit test injects a fake that
 * records argv and materializes canned output files instead of doing a real
 * docker/cargo/pnpm/tar build. */
function defaultExec(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", cwd: REPO_ROOT, ...options });
}

function defaultEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("could not allocate an ephemeral port")));
      }
    });
    server.on("error", reject);
  });
}

/**
 * Five non-conflicting ephemeral ports, allocated up front — preparation,
 * not world startup. `server` and `anyharness` are baked into the Desktop
 * renderer's VITE_* build-time URLs below, so `constructLocalWorld` MUST
 * reuse this exact allocation (read from the ports file this script writes
 * into the run directory) rather than re-probing its own — otherwise the
 * renderer's baked URLs would not match the world it boots into.
 */
export async function allocateLocalWorldPorts(deps = {}) {
  const alloc = deps.ephemeralPort ?? defaultEphemeralPort;
  const [server, postgres, redis, anyharness, renderer] = await Promise.all([
    alloc(),
    alloc(),
    alloc(),
    alloc(),
    alloc(),
  ]);
  return { server, postgres, redis, anyharness, renderer };
}

function requireRegularFile(filePath, what) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch (error) {
    throw new Error(
      `${what} was not produced at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(`${what} at ${filePath} is not a regular file`);
  }
}

function requireSafeId(value, what) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${what} must be a safe id, got "${value}"`);
  }
  return value;
}

/**
 * `rustc -vV` host target triple, resolved through the same injectable exec
 * seam as every other external call in this module (unlike the sibling
 * assembler's `rustHostTarget()`, which always shells out for real — this
 * copy exists so a caller that never supplies `options.target` still gets a
 * fully offline, fake-exec-driven unit test).
 */
export function resolveRustHostTarget(exec = defaultExec) {
  const output = exec("rustc", ["-vV"]);
  const match = output.match(/^host:\s*(\S+)$/m);
  if (!match) {
    throw new Error("could not parse host target from rustc -vV");
  }
  return match[1];
}

/**
 * `docker version -f '{{.Server.Os}}/{{.Server.Arch}}'`, normalized (e.g.
 * `linux/arm64`) — used verbatim as the `server/<docker-platform>` artifact
 * id suffix.
 */
export function resolveDockerPlatform(exec = defaultExec) {
  const output = exec("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]);
  const platform = output.trim();
  if (!/^[a-z0-9]+\/[a-z0-9]+$/.test(platform)) {
    throw new Error(`could not resolve a safe docker platform from "${platform}"`);
  }
  return platform;
}

/** Builds the Server image from server/Dockerfile and docker-saves it to
 * `outputPath`. Returns the resolved image tag. */
export function buildServerArchive({ outputPath, version, exec = defaultExec, log = () => {} }) {
  const tag = `proliferate-server-qualification:${version}`;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  log(`docker build -f server/Dockerfile --build-arg SERVER_VERSION=${version} -t ${tag} .`);
  exec("docker", ["build", "-f", "server/Dockerfile", "--build-arg", `SERVER_VERSION=${version}`, "-t", tag, "."]);
  log(`docker save -o ${outputPath} ${tag}`);
  exec("docker", ["save", "-o", outputPath, tag]);
  requireRegularFile(outputPath, "Server docker-save archive");
  return tag;
}

/**
 * Builds the release AnyHarness binary for the host Rust target, stamped
 * with the repository VERSION and source SHA (same convention as
 * `make qualification-candidate-handoff-smoke`), and materializes it at
 * `outputPath`.
 */
export function buildAnyharnessBinary({
  outputPath,
  version,
  sourceSha,
  targetDir,
  exec = defaultExec,
  log = () => {},
}) {
  log("cargo build --release -p anyharness");
  exec("cargo", ["build", "--release", "-p", "anyharness"], {
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDir,
      PROLIFERATE_BUILD_VERSION: version,
      PROLIFERATE_BUILD_SHA: sourceSha,
    },
  });
  const builtPath = path.join(targetDir, "release", "anyharness");
  requireRegularFile(builtPath, "release AnyHarness binary");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  copyFileSync(builtPath, outputPath);
  chmodSync(outputPath, 0o755);
  requireRegularFile(outputPath, "materialized AnyHarness binary");
  return outputPath;
}

/**
 * Builds the Desktop renderer dist with this run's allocated API/AnyHarness
 * URLs baked in via VITE_PROLIFERATE_API_BASE_URL / VITE_ANYHARNESS_DEV_URL,
 * then archives the dist directory to `outputPath`.
 */
export function buildDesktopRendererArchive({
  outputPath,
  apiBaseUrl,
  anyharnessDevUrl,
  distDir = path.join(REPO_ROOT, "apps", "desktop", "dist"),
  exec = defaultExec,
  log = () => {},
}) {
  // The Desktop app's package name is `proliferate` (apps/desktop/package.json),
  // NOT `@proliferate/desktop`; the latter matches no pnpm project and silently
  // builds nothing. Its `build` script also builds the shared frontend packages
  // it consumes as dist before `tsc && vite build`.
  log("pnpm --filter proliferate build (VITE_* set to this run's allocated URLs)");
  exec("pnpm", ["--filter", "proliferate", "build"], {
    env: {
      ...process.env,
      VITE_PROLIFERATE_API_BASE_URL: apiBaseUrl,
      VITE_ANYHARNESS_DEV_URL: anyharnessDevUrl,
    },
  });
  requireRegularFile(path.join(distDir, "index.html"), "Desktop renderer dist");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  // Pack the CONTENTS of dist at the archive root (`-C distDir .`), so
  // `index.html` lands directly under the extraction dir — the layout the
  // world's renderer server serves from (`renderer.ts` "Archive layout
  // contract"). Packing the `dist/` directory itself would nest index.html one
  // level too deep and the static server's SPA fallback would 500.
  log(`tar -czf ${outputPath} -C ${distDir} .`);
  exec("tar", ["-czf", outputPath, "-C", distDir, "."]);
  requireRegularFile(outputPath, "Desktop renderer archive");
  return outputPath;
}

/**
 * Orchestrates the full local build: allocates ports, builds the three
 * candidates, assembles and writes the candidate build map and the ports
 * file, and returns the machine-readable summary this script prints.
 *
 * Every side-effecting step is behind an injectable `exec`/`ephemeralPort`
 * seam so the unit test can fake all of docker/cargo/pnpm/tar and exercise
 * this orchestration deterministically and offline — no real builds run in
 * the unit test.
 */
export async function buildLocalQualificationCandidates(options, deps = {}) {
  const runId = requireSafeId(options.runId, "--run-id");
  const shardId = requireSafeId(options.shardId, "--shard-id");
  if (!options.runDir) {
    throw new Error("--run-dir <path> is required");
  }
  const runDir = path.resolve(options.runDir);
  const exec = deps.exec ?? defaultExec;
  const log = deps.log ?? (() => {});
  const alloc = deps.allocatePorts ?? allocateLocalWorldPorts;

  const sourceSha = (options.sourceSha ?? gitHeadSha()).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`source SHA must be a lowercase 40-hex commit SHA, got "${sourceSha}"`);
  }
  const version = (options.version ?? repositoryVersion()).trim();
  const target = (options.target ?? resolveRustHostTarget(exec)).trim();
  const dockerPlatform = options.dockerPlatform ?? resolveDockerPlatform(exec);

  log(`allocating non-conflicting ports for run=${runId} shard=${shardId}`);
  const ports = await alloc({ ephemeralPort: deps.ephemeralPort });

  const artifactsDir = path.join(runDir, "artifacts");
  const serverArchivePath = path.join(artifactsDir, "server.tar");
  const anyharnessBinaryPath = path.join(artifactsDir, "anyharness");
  const rendererArchivePath = path.join(artifactsDir, "renderer.tar.gz");
  const anyharnessTargetDir = path.join(runDir, "cargo-target");

  buildServerArchive({ outputPath: serverArchivePath, version, exec, log });

  buildAnyharnessBinary({
    outputPath: anyharnessBinaryPath,
    version,
    sourceSha,
    targetDir: anyharnessTargetDir,
    exec,
    log,
  });

  const apiBaseUrl = `http://127.0.0.1:${ports.server}`;
  const anyharnessDevUrl = `http://127.0.0.1:${ports.anyharness}`;
  buildDesktopRendererArchive({
    outputPath: rendererArchivePath,
    apiBaseUrl,
    anyharnessDevUrl,
    distDir: options.desktopDistDir,
    exec,
    log,
  });

  const map = assembleCandidateBuildMapFromArtifacts({
    sourceSha,
    defaultVersion: version,
    artifacts: [
      { artifactId: `server/${dockerPlatform}`, path: serverArchivePath },
      { artifactId: `anyharness/${target}`, path: anyharnessBinaryPath },
      { artifactId: "desktop-renderer/browser", path: rendererArchivePath },
    ],
  });

  const candidateBuildMapPath = path.join(runDir, "candidate-build.json");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(candidateBuildMapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");

  const portsPath = path.join(runDir, "local-world-ports.json");
  writeFileSync(portsPath, `${JSON.stringify(ports, null, 2)}\n`, "utf8");

  return {
    run_id: runId,
    shard_id: shardId,
    candidate_build_map: candidateBuildMapPath,
    ports_file: portsPath,
    ports,
    urls: { api_base_url: apiBaseUrl, anyharness_dev_url: anyharnessDevUrl },
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const summary = await buildLocalQualificationCandidates({
    runId: argValue("--run-id"),
    shardId: argValue("--shard-id"),
    runDir: argValue("--run-dir"),
    sourceSha: argValue("--source-sha"),
    version: argValue("--version"),
    target: argValue("--target"),
  }, {
    log: (message) => console.error(`[build-local-qualification-candidates] ${message}`),
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
