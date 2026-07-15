#!/usr/bin/env node
// The one local/Actions producer of the self-host-world candidates
// (Prove One Real Self-Hosted Installation — "Candidate artifacts"):
//
//   allocate the controller-local ports the renderer/AnyHarness use
//   -> build the candidate Server image for the BOX arch and docker-save it
//   -> build the release-shaped proliferate-deploy.tar.gz + its SHA256SUMS
//      EXACTLY the way server-ci.yml `self-hosted-release-assets` builds them
//   -> reuse the PR 1 release AnyHarness build (controller host, not the box)
//   -> reuse the PR 1 Desktop renderer build (connected to the box at runtime
//      through the Connect-Server trust flow)
//   -> assemble one four-artifact candidate map (all local_file; no schema change)
//
// `make qualification-selfhost` and the release-e2e selfhost job both call this
// same script; there is no second implementation of these build steps. The
// server image is docker-saved (not pushed): the install driver `docker load`s
// it on the box and the running image digest is asserted there as a receipt.
// This script never provisions AWS, starts a server, or claims anything.
//
// Usage:
//   node scripts/ci-cd/build-selfhost-qualification-candidates.mjs \
//     --run-id <run-id> --shard-id <shard-id> --run-dir <path> \
//     [--source-sha <40-hex>] [--version <v>] [--target <rust-triple>] \
//     [--platform linux/amd64|linux/arm64] \
//     [--api-base-url https://<run>.qualification.proliferate.com] \
//     [--second-ports]
//
// `--api-base-url` is baked into the web renderer as VITE_PROLIFERATE_API_BASE_URL
// (see buildSelfHostQualificationCandidates); it is this run's own deterministic
// self-host instance URL. Omit it only for offline unit tests (falls back to a
// dead local origin — never a hosted API).
//
// `--second-ports` (opt-in, off by default) additionally allocates a SECOND
// non-overlapping controller-local port set with the same allocation function
// used for the first, and writes it as a sidecar `local-world-ports-b.json`
// next to `local-world-ports.json` (same LocalWorldPorts shape: server,
// postgres, redis, anyharness, renderer). This is for the cross-server
// isolation scenario (SH-SWITCH-ISOLATION), which today derives its second
// server's ports from the first by a fixed offset
// (`tests/release/src/worlds/selfhost/world.ts` `SECOND_WORLD_PORT_OFFSET`) —
// see the `TODO(builder-flag, other workstream)` there. With this flag off,
// every output is byte-identical to before this flag existed.
//
// Prints one line of machine-readable JSON to stdout on success:
//   {"run_id":...,"shard_id":...,"candidate_build_map":"<path>",
//    "bundle_sha256sums":"<path>","ports_file":"<path>",
//    "ports":{...},"platform":"linux/amd64"}
//   plus, only when --second-ports is passed:
//   {..., "second_ports_file":"<path>","second_ports":{...}}
//
// The `self-hosted-assets.SHA256SUMS` is written as a DETERMINISTIC SIBLING of
// the bundle inside the map's artifacts dir; the self-host world derives its
// path from the bundle locator (dirname(bundle)/self-hosted-assets.SHA256SUMS)
// and scp's it to the box for the shipped installer's checksum-verify.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  allocateLocalWorldPorts,
  buildAnyharnessBinary,
  buildDesktopRendererArchive,
  resolveRustHostTarget,
} from "./build-local-qualification-candidates.mjs";
import { assembleCandidateBuildMapFromArtifacts, gitHeadSha, repositoryVersion } from "./assemble-candidate-build-map.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// The default EC2 instance type (t3.small) is x86_64, so the box image defaults
// to linux/amd64; --platform selects an arm64 box (e.g. t4g.*).
const DEFAULT_BOX_PLATFORM = "linux/amd64";

/** Default exec seam: real execFileSync. The unit test injects a fake that
 * records argv and materializes canned output files instead of doing a real
 * docker/cargo/pnpm/tar build. */
function defaultExec(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", cwd: REPO_ROOT, ...options });
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

function checkPlatform(platform) {
  if (!/^linux\/(amd64|arm64)$/.test(platform)) {
    throw new Error(`--platform must be linux/amd64 or linux/arm64, got "${platform}"`);
  }
  return platform;
}

const SECOND_PORTS_MAX_ATTEMPTS = 5;

function portSetsOverlap(a, b) {
  const taken = new Set(Object.values(a));
  return Object.values(b).some((port) => taken.has(port));
}

/**
 * Allocates a second controller-local port set that does not overlap `first`,
 * using the same `alloc` function `first` came from. Ephemeral OS ports are
 * not guaranteed distinct across two independent allocation passes (a freed
 * port can be immediately reissued), so this retries a bounded number of
 * times and fails closed (throws) rather than silently handing back a
 * colliding set.
 */
export async function allocateSecondLocalWorldPorts(alloc, first, { ephemeralPort, maxAttempts = SECOND_PORTS_MAX_ATTEMPTS } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = await alloc({ ephemeralPort });
    if (!portSetsOverlap(first, candidate)) {
      return candidate;
    }
  }
  throw new Error(`could not allocate a second, non-overlapping controller-local port set after ${maxAttempts} attempts`);
}

/**
 * Builds the candidate Server image for the BOX platform from server/Dockerfile
 * and docker-saves it to `outputPath`. The install driver `docker load`s this
 * archive on the EC2 box, and `.env.static` is pinned to the loaded tag — never
 * `stable`/`latest`. Uses `buildx --load` so a single-platform image lands in
 * the local daemon for the save. Returns the resolved image repo/tag.
 */
export function buildServerImageArchive({ outputPath, version, platform, exec = defaultExec, log = () => {} }) {
  const repo = "proliferate-server-qualification";
  const tag = `${repo}:${version}`;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  log(`docker buildx build --platform ${platform} -f server/Dockerfile --build-arg SERVER_VERSION=${version} -t ${tag} --load .`);
  exec("docker", [
    "buildx",
    "build",
    "--platform",
    platform,
    "-f",
    "server/Dockerfile",
    "--build-arg",
    `SERVER_VERSION=${version}`,
    "-t",
    tag,
    "--load",
    ".",
  ]);
  log(`docker save -o ${outputPath} ${tag}`);
  exec("docker", ["save", "-o", outputPath, tag]);
  requireRegularFile(outputPath, "Server docker-save archive");
  return { repo, tag, version };
}

/**
 * Builds `proliferate-deploy.tar.gz` + `self-hosted-assets.SHA256SUMS` EXACTLY
 * the way `server-ci.yml self-hosted-release-assets` builds the release bundle:
 * `cp -R server/deploy/. proliferate-deploy/`, drop the CI-only `smoke/` and
 * `tests/`, write `VERSION`, then a reproducible root-owned tar and a bare-name
 * checksum. This is never reconstructed ad-hoc from loose source — the shipped
 * installer checksum-verifies exactly this artifact.
 */
export function buildSelfHostDeployBundle({
  bundleOutputPath,
  sumsOutputPath,
  version,
  deployDir = path.join(REPO_ROOT, "server", "deploy"),
  exec = defaultExec,
  log = () => {},
}) {
  const artifactsDir = path.dirname(bundleOutputPath);
  mkdirSync(artifactsDir, { recursive: true });
  const bundleRoot = mkdtempSync(path.join(os.tmpdir(), "proliferate-selfhost-bundle-"));
  try {
    const stageDir = path.join(bundleRoot, "proliferate-deploy");
    mkdirSync(stageDir, { recursive: true });
    log(`cp -R ${deployDir}/. ${stageDir}/`);
    exec("cp", ["-R", `${deployDir}/.`, `${stageDir}/`]);
    // smoke/ and tests/ are CI-only; the operator bundle ships just the scripts,
    // compose, and config the running stack needs (server-ci parity).
    exec("rm", ["-rf", path.join(stageDir, "smoke")]);
    exec("rm", ["-rf", path.join(stageDir, "tests")]);
    writeFileSync(path.join(stageDir, "VERSION"), `${version}\n`);
    // Archive as root:root, numeric owner (server-ci parity) so a root
    // extraction on the box does not hand ownership to the builder's uid.
    log(`tar czf ${bundleOutputPath} --owner=0 --group=0 --numeric-owner -C ${bundleRoot} proliferate-deploy`);
    // COPYFILE_DISABLE=1 stops macOS bsdtar from injecting `._*` AppleDouble
    // entries into the archive (harmless/ignored on Linux). Without it the
    // qualification bundle diverges from the Linux server-ci release bundle and
    // extracts junk `._Caddyfile`/`._bootstrap.sh` files onto the box.
    exec(
      "tar",
      ["czf", bundleOutputPath, "--owner=0", "--group=0", "--numeric-owner", "-C", bundleRoot, "proliferate-deploy"],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    requireRegularFile(bundleOutputPath, "self-host deploy bundle");

    // Bare-name checksum (run in the artifacts dir) so `sha256sum -c` inside the
    // shipped installer resolves the entry as a sibling filename.
    const bundleBasename = path.basename(bundleOutputPath);
    log(`sha256sum ${bundleBasename} > ${path.basename(sumsOutputPath)}`);
    const sums = exec("sha256sum", [bundleBasename], { cwd: artifactsDir });
    writeFileSync(sumsOutputPath, sums);
    requireRegularFile(sumsOutputPath, "self-host bundle SHA256SUMS");
  } finally {
    rmSync(bundleRoot, { recursive: true, force: true });
  }
  return { bundleOutputPath, sumsOutputPath };
}

/**
 * Orchestrates the full self-host build: allocates the controller-local ports,
 * builds the four candidates, assembles + writes the candidate build map, the
 * bundle checksum sibling, and the ports file, and returns the machine-readable
 * summary this script prints. Every side-effecting step is behind an injectable
 * `exec`/`allocatePorts` seam so the unit test fakes all of docker/cargo/pnpm/
 * tar and exercises this orchestration deterministically and offline.
 */
export async function buildSelfHostQualificationCandidates(options, deps = {}) {
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
  const platform = checkPlatform(options.platform ?? DEFAULT_BOX_PLATFORM);

  log(`allocating controller-local ports for run=${runId} shard=${shardId}`);
  const ports = await alloc({ ephemeralPort: deps.ephemeralPort });

  let secondPorts;
  if (options.secondPorts) {
    log(`allocating a second, non-overlapping controller-local port set for run=${runId} shard=${shardId}`);
    secondPorts = await allocateSecondLocalWorldPorts(alloc, ports, { ephemeralPort: deps.ephemeralPort });
  }

  const artifactsDir = path.join(runDir, "artifacts");
  const serverImageArchivePath = path.join(artifactsDir, "server-image.tar");
  const bundlePath = path.join(artifactsDir, "proliferate-deploy.tar.gz");
  const sumsPath = path.join(artifactsDir, "self-hosted-assets.SHA256SUMS");
  const anyharnessBinaryPath = path.join(artifactsDir, "anyharness");
  const rendererArchivePath = path.join(artifactsDir, "renderer.tar.gz");
  const anyharnessTargetDir = path.join(runDir, "cargo-target");

  buildServerImageArchive({ outputPath: serverImageArchivePath, version, platform, exec, log });

  buildSelfHostDeployBundle({
    bundleOutputPath: bundlePath,
    sumsOutputPath: sumsPath,
    version,
    deployDir: options.deployDir,
    exec,
    log,
  });

  // Controller-local AnyHarness (reused PR 1 build) — runs on the runner host,
  // NOT the box, pointed at the remote self-host API at runtime.
  buildAnyharnessBinary({
    outputPath: anyharnessBinaryPath,
    version,
    sourceSha,
    targetDir: anyharnessTargetDir,
    exec,
    log,
  });

  // The self-host renderer is the PLAIN WEB build (`--desktop web`), whose only
  // API-base source is the baked `VITE_PROLIFERATE_API_BASE_URL`
  // (`getProliferateApiBaseUrl`): the Connect-Server runtime-config repoint is
  // Tauri-only (`setDesktopAppConfig` `invoke`s a native command that throws in
  // the browser), so a web renderer CANNOT be pointed at the instance at
  // runtime. It must therefore be baked with THIS RUN's own self-host API URL,
  // which is deterministic from the run/shard id (`--api-base-url`, computed by
  // the caller from `runSubdomainLabel` + the qualification zone). That URL is
  // the run's unique per-run instance — it cannot leak to the shared hosted API.
  // Falls back to a dead local origin only when no run URL is supplied (offline
  // unit tests), never a hosted origin.
  const apiBaseUrl = options.apiBaseUrl?.trim() || `http://127.0.0.1:${ports.server}`;
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
      { artifactId: `server/${platform}`, path: serverImageArchivePath },
      { artifactId: `selfhost-bundle/${platform}`, path: bundlePath },
      { artifactId: `anyharness/${target}`, path: anyharnessBinaryPath },
      { artifactId: "desktop-renderer/browser", path: rendererArchivePath },
    ],
  });

  const candidateBuildMapPath = path.join(runDir, "candidate-build.json");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(candidateBuildMapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");

  // Must match LOCAL_WORLD_PORTS_FILENAME ("local-world-ports.json") — the CLI's
  // readLocalWorldPortsFile derives ctx.ports from exactly this sibling name
  // (same reader PR 1 wired). A run-specific name here leaves ctx.ports null and
  // the self-host world fails closed on "no pre-allocated local-world ports".
  const portsPath = path.join(runDir, "local-world-ports.json");
  writeFileSync(portsPath, `${JSON.stringify(ports, null, 2)}\n`, "utf8");

  // Sidecar second port set (opt-in, --second-ports). Same LocalWorldPorts
  // shape/filename convention as local-world-ports.json, just "-b" suffixed —
  // never written when the flag is off, so default output is untouched.
  let secondPortsPath;
  if (secondPorts) {
    secondPortsPath = path.join(runDir, "local-world-ports-b.json");
    writeFileSync(secondPortsPath, `${JSON.stringify(secondPorts, null, 2)}\n`, "utf8");
  }

  return {
    run_id: runId,
    shard_id: shardId,
    candidate_build_map: candidateBuildMapPath,
    bundle_sha256sums: sumsPath,
    ports_file: portsPath,
    ports,
    platform,
    ...(secondPortsPath ? { second_ports_file: secondPortsPath, second_ports: secondPorts } : {}),
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const summary = await buildSelfHostQualificationCandidates(
    {
      runId: argValue("--run-id"),
      shardId: argValue("--shard-id"),
      runDir: argValue("--run-dir"),
      sourceSha: argValue("--source-sha"),
      version: argValue("--version"),
      target: argValue("--target"),
      platform: argValue("--platform"),
      apiBaseUrl: argValue("--api-base-url"),
      secondPorts: process.argv.includes("--second-ports"),
    },
    {
      log: (message) => console.error(`[build-selfhost-qualification-candidates] ${message}`),
    },
  );
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
