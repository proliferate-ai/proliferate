#!/usr/bin/env node
// The local/Actions producer of the six managed-cloud-world candidates
// ("Prove One Real Managed-Cloud Workspace" — "Candidate artifacts" table,
// BRIEF §3 "Workstream B — Template + builders"):
//
//   choose run/shard identity and allocate the run subdomain
//   -> build the three musl runtime binaries (anyharness/worker/supervisor)
//   -> reference the checked-in git-credential-helper script
//   -> build the Server image (linux/amd64) and docker-save it
//   -> build the Desktop renderer with its API base URL baked to the public
//      candidate-API origin
//   -> assemble the six-artifact candidate map + a subdomain sidecar
//
// `make qualification-managed-cloud` and the release-e2e.yml manual job both
// call this same script — there is no second implementation of these build
// steps. The local-world builder (build-local-qualification-candidates.mjs)
// is untouched (extension contract: new worlds get new builder files).
//
// Deviation from a literal reading of the BRIEF (disclosed): this script does
// NOT build or publish the immutable E2B template. The contracts-stage
// authored `cloud-candidate-set.ts`/BRIEF §0 note that `e2b-template/*` and
// `candidate-api/*` are WORLD-produced receipts, never candidate-map entries
// ("Composite/deployment entries bind their inputs in their own receipts").
// The frozen spec's "World construction" step 4 assigns the template
// build+publish to `constructManagedCloudWorld` (workstream A) calling
// `resolveOrBuildManagedCloudTemplate` (this workstream's
// `src/worlds/managed-cloud/template.ts`) at world-construction time, using
// the four musl/credential-helper artifacts this script produces. Building it
// twice here would (a) require importing tests/release's TypeScript sources
// from this plain-JS script (no precedent in this repo — the local builder
// never imports TS), and (b) risk a second, disconnected content-hash cache
// entry. One producer (`template.ts`, called by the world) is the simpler,
// spec-literal choice.
//
// Usage:
//   node scripts/ci-cd/build-cloud-qualification-candidates.mjs \
//     --run-id <run-id> --shard-id <shard-id> --run-dir <path> \
//     [--source-sha <40-hex>] [--version <v>] [--zone-domain qualification.proliferate.com]
//
// Prints one line of machine-readable JSON to stdout on success:
//   {"run_id":...,"shard_id":...,"candidate_build_map":"<path>",
//    "subdomain_file":"<path>","subdomain":"...","urls":{"api_base_url":"..."}}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assembleCandidateBuildMapFromArtifacts, gitHeadSha, repositoryVersion } from "./assemble-candidate-build-map.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LINUX_MUSL_TARGET = "x86_64-unknown-linux-musl";
const CREDENTIAL_HELPER_SOURCE = path.join(REPO_ROOT, "install", "proliferate-git-credential-helper");
const DEFAULT_ZONE_DOMAIN = "qualification.proliferate.com";

/** Default exec seam: real execFileSync. The unit test injects a fake that
 * records argv and materializes canned output files instead of doing a real
 * cargo/docker/pnpm/tar build. */
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

/**
 * DNS-label-safe lowercase token: alphanumeric and dashes only, no leading/
 * trailing dash, bounded to a real DNS label length.
 */
function sanitizeDnsLabel(value, what) {
  const lowered = String(value).toLowerCase();
  const sanitized = lowered.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (sanitized.length === 0) {
    throw new Error(`${what} produced an empty DNS label from "${value}"`);
  }
  return sanitized.slice(0, 63);
}

/**
 * Allocates the run-scoped candidate-API subdomain (spec: `<run>.qualification.proliferate.com`).
 * Shard id is folded in only when it is not the trivial "1" shard, so the
 * common single-shard case matches the spec's literal form while still
 * guaranteeing two concurrent runs never collide on the same shard.
 */
export function allocateCloudWorldSubdomain({ runId, shardId, zoneDomain = DEFAULT_ZONE_DOMAIN, attemptSuffix }) {
  const runLabel = sanitizeDnsLabel(runId, "--run-id");
  const shardLabel = sanitizeDnsLabel(shardId, "--shard-id");
  const base = shardLabel === "1" ? runLabel : `${runLabel}-${shardLabel}`;
  // A fresh random suffix per BUILD (stable across REUSE_CANDIDATES reruns via
  // the sidecar): Let's Encrypt rate-limits failed validations and duplicate
  // certificates PER EXACT NAME, so re-running against a reused subdomain
  // starves cert issuance after a few attempts (observed live: Caddy stalls at
  // "waiting on internal rate limiter" and :443 never opens). A per-build name
  // keeps every run LE-fresh; the zone stays run-scoped and cleaned.
  const suffix = attemptSuffix ?? randomBytes(2).toString("hex");
  const label = `${base}-${sanitizeDnsLabel(suffix, "attempt suffix")}`;
  const subdomain = `${label}.${zoneDomain}`;
  return { subdomain, apiBaseUrl: `https://${subdomain}` };
}

/**
 * Builds the three musl runtime binaries via `cargo zigbuild`, stamped with
 * the repository VERSION and source SHA, reusing the exact target/package set
 * `Makefile cloud-runtime-build` and `.github/workflows/_deploy-e2b.yml` use
 * (prework fact 4: "reuse this path verbatim"). Materializes each binary at
 * `outputDir/<name>`.
 */
export function buildCloudMuslBinaries({ outputDir, version, sourceSha, targetDir, exec = defaultExec, log = () => {} }) {
  log("cargo zigbuild --release --target x86_64-unknown-linux-musl -p anyharness -p proliferate-worker -p proliferate-supervisor");
  exec(
    "cargo",
    ["zigbuild", "--release", "--target", LINUX_MUSL_TARGET, "-p", "anyharness", "-p", "proliferate-worker", "-p", "proliferate-supervisor"],
    {
      env: {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
        PROLIFERATE_BUILD_VERSION: version,
        PROLIFERATE_BUILD_SHA: sourceSha,
      },
    },
  );

  mkdirSync(outputDir, { recursive: true });
  const releaseDir = path.join(targetDir, LINUX_MUSL_TARGET, "release");
  const binaries = {};
  for (const [key, binaryName] of [
    ["anyharness", "anyharness"],
    ["worker", "proliferate-worker"],
    ["supervisor", "proliferate-supervisor"],
  ]) {
    const builtPath = path.join(releaseDir, binaryName);
    requireRegularFile(builtPath, `release ${binaryName} (${LINUX_MUSL_TARGET}) binary`);
    const outputPath = path.join(outputDir, binaryName);
    copyFileSync(builtPath, outputPath);
    chmodSync(outputPath, 0o755);
    requireRegularFile(outputPath, `materialized ${binaryName} binary`);
    binaries[key] = outputPath;
  }
  return binaries;
}

/**
 * Materializes the checked-in git-credential-helper script into the run's
 * artifact directory. It is a portable POSIX shell script (not
 * target-specific), consumed by the production template bake the same way —
 * see `scripts/build-template.mjs`'s `GIT_CREDENTIAL_HELPER_PATH`. The
 * `x86_64-unknown-linux-musl` artifact-id suffix matches the other three
 * runtime artifacts for a consistent slot shape, not a compiled target.
 */
export function materializeCredentialHelperArtifact({ outputDir, sourcePath = CREDENTIAL_HELPER_SOURCE }) {
  requireRegularFile(sourcePath, "git-credential-helper source script");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "proliferate-git-credential-helper");
  copyFileSync(sourcePath, outputPath);
  chmodSync(outputPath, 0o755);
  return outputPath;
}

/**
 * Builds the Server image for `linux/amd64` (matching the x86_64 EC2 ingress
 * host and E2B, per prework — NOT the host's native platform) via
 * `docker buildx`, loads it locally, and docker-saves it to `outputPath`.
 */
export function buildServerArchiveAmd64({ outputPath, version, exec = defaultExec, log = () => {} }) {
  const tag = `proliferate-server-qualification-cloud:${version}`;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  log(`docker buildx build --platform linux/amd64 --load -f server/Dockerfile --build-arg SERVER_VERSION=${version} -t ${tag} .`);
  exec("docker", [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--load",
    "-f",
    "server/Dockerfile",
    "--build-arg",
    `SERVER_VERSION=${version}`,
    "-t",
    tag,
    ".",
  ]);
  log(`docker save -o ${outputPath} ${tag}`);
  exec("docker", ["save", "-o", outputPath, tag]);
  requireRegularFile(outputPath, "Server docker-save archive (linux/amd64)");
  return tag;
}

/**
 * Builds the Desktop renderer dist with this run's public candidate-API
 * origin baked in via `VITE_PROLIFERATE_API_BASE_URL`, then archives the dist
 * directory to `outputPath` (same archive-layout contract as the local
 * builder: contents at the archive root).
 */
export function buildDesktopRendererArchiveForCloud({
  outputPath,
  apiBaseUrl,
  distDir = path.join(REPO_ROOT, "apps", "desktop", "dist"),
  exec = defaultExec,
  log = () => {},
}) {
  log("pnpm --filter proliferate build (VITE_PROLIFERATE_API_BASE_URL set to the public candidate-API origin)");
  exec("pnpm", ["--filter", "proliferate", "build"], {
    env: {
      ...process.env,
      VITE_PROLIFERATE_API_BASE_URL: apiBaseUrl,
    },
  });
  requireRegularFile(path.join(distDir, "index.html"), "Desktop renderer dist");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  log(`tar -czf ${outputPath} -C ${distDir} .`);
  exec("tar", ["-czf", outputPath, "-C", distDir, "."]);
  requireRegularFile(outputPath, "Desktop renderer archive");
  return outputPath;
}

/**
 * Orchestrates the full cloud build: allocates the run subdomain, builds the
 * six candidates, assembles and writes the candidate build map and the
 * subdomain sidecar, and returns the machine-readable summary this script
 * prints. Every side-effecting step is behind an injectable `exec` seam so
 * the unit test can fake cargo/docker/pnpm/tar and exercise this
 * orchestration deterministically and offline — no real build runs in the
 * unit test.
 */
export async function buildCloudQualificationCandidates(options, deps = {}) {
  const runId = requireSafeId(options.runId, "--run-id");
  const shardId = requireSafeId(options.shardId, "--shard-id");
  if (!options.runDir) {
    throw new Error("--run-dir <path> is required");
  }
  const runDir = path.resolve(options.runDir);
  const exec = deps.exec ?? defaultExec;
  const log = deps.log ?? (() => {});

  const sourceSha = (options.sourceSha ?? gitHeadSha()).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`source SHA must be a lowercase 40-hex commit SHA, got "${sourceSha}"`);
  }
  const version = (options.version ?? repositoryVersion()).trim();
  const zoneDomain = options.zoneDomain ?? DEFAULT_ZONE_DOMAIN;

  log(`allocating run subdomain for run=${runId} shard=${shardId}`);
  const { subdomain, apiBaseUrl } = allocateCloudWorldSubdomain({ runId, shardId, zoneDomain, attemptSuffix: options.attemptSuffix });

  const artifactsDir = path.join(runDir, "artifacts");
  const serverArchivePath = path.join(artifactsDir, "server.tar");
  const rendererArchivePath = path.join(artifactsDir, "renderer.tar.gz");
  const runtimeTargetDir = path.join(runDir, "cargo-target");

  const muslBinaries = buildCloudMuslBinaries({
    outputDir: artifactsDir,
    version,
    sourceSha,
    targetDir: runtimeTargetDir,
    exec,
    log,
  });
  const credentialHelperPath = materializeCredentialHelperArtifact({
    outputDir: artifactsDir,
    sourcePath: options.credentialHelperSourcePath,
  });

  buildServerArchiveAmd64({ outputPath: serverArchivePath, version, exec, log });

  buildDesktopRendererArchiveForCloud({
    outputPath: rendererArchivePath,
    apiBaseUrl,
    distDir: options.desktopDistDir,
    exec,
    log,
  });

  const map = assembleCandidateBuildMapFromArtifacts({
    sourceSha,
    defaultVersion: version,
    artifacts: [
      { artifactId: "server/linux/amd64", path: serverArchivePath },
      { artifactId: `anyharness/${LINUX_MUSL_TARGET}`, path: muslBinaries.anyharness },
      { artifactId: `worker/${LINUX_MUSL_TARGET}`, path: muslBinaries.worker },
      { artifactId: `supervisor/${LINUX_MUSL_TARGET}`, path: muslBinaries.supervisor },
      { artifactId: `credential-helper/${LINUX_MUSL_TARGET}`, path: credentialHelperPath },
      { artifactId: "desktop-renderer/browser", path: rendererArchivePath },
    ],
  });

  const candidateBuildMapPath = path.join(runDir, "candidate-build.json");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(candidateBuildMapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");

  const subdomainPath = path.join(runDir, "cloud-world-subdomain.json");
  writeFileSync(subdomainPath, `${JSON.stringify({ subdomain, apiBaseUrl }, null, 2)}\n`, "utf8");

  return {
    run_id: runId,
    shard_id: shardId,
    candidate_build_map: candidateBuildMapPath,
    subdomain_file: subdomainPath,
    subdomain,
    urls: { api_base_url: apiBaseUrl },
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const summary = await buildCloudQualificationCandidates(
    {
      runId: argValue("--run-id"),
      shardId: argValue("--shard-id"),
      runDir: argValue("--run-dir"),
      sourceSha: argValue("--source-sha"),
      version: argValue("--version"),
      zoneDomain: argValue("--zone-domain"),
    },
    { log: (message) => console.error(`[build-cloud-qualification-candidates] ${message}`) },
  );
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
