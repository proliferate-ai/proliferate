#!/usr/bin/env node
// Portable CandidateBuildMapV1 assembler
// (specs/developing/testing/candidate-build-handoff.md "Candidate build map").
// Given one or more built artifacts, computes their SHA-256 and writes the
// local_file-only candidate build map the qualification runner consumes.
// Defaults derive the source SHA from `git rev-parse HEAD` and the version
// from the repository VERSION file.
//
// Single-artifact usage (back-compat; unchanged since PR #1159):
//   node scripts/ci-cd/assemble-candidate-build-map.mjs \
//     --binary <path> --output <path> \
//     [--source-sha <40-hex>] [--version <v>] [--target <rust-triple>] \
//     [--artifact-prefix anyharness]
//
// Multi-artifact usage ("Prove One Real Local Workspace Turn" — the three
// exact candidates: server/<docker-platform>, anyharness/<rust-host-target>,
// desktop-renderer/browser):
//   node scripts/ci-cd/assemble-candidate-build-map.mjs \
//     --artifact server/linux/arm64=/path/to/server.tar:0.3.28 \
//     --artifact anyharness/aarch64-apple-darwin=/path/to/anyharness:0.3.28 \
//     --artifact desktop-renderer/browser=/path/to/renderer.tar:0.3.28 \
//     --output <path> [--source-sha <40-hex>] [--version <default-version>]
//
// `--artifact` may be repeated and must not be combined with `--binary`.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_ARTIFACT_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 128;

function resolveSourceSha(sourceSha) {
  const resolved = (sourceSha ?? gitHeadSha()).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolved)) {
    throw new Error(`source SHA must be a lowercase 40-hex commit SHA, got "${resolved}"`);
  }
  return resolved;
}

function resolveVersion(version) {
  const resolved = (version ?? repositoryVersion()).trim();
  if (resolved.length === 0 || resolved.length > MAX_VERSION_LENGTH) {
    throw new Error("version must be non-empty and bounded");
  }
  return resolved;
}

function checkArtifactId(artifactId) {
  // Same contract as the runner-side loader
  // (tests/release/src/artifacts/build-map.ts): the assembler must never be
  // able to emit a map the runner would reject.
  if (
    typeof artifactId !== "string" ||
    artifactId.length === 0 ||
    artifactId.length > MAX_ARTIFACT_ID_LENGTH ||
    !ARTIFACT_ID_PATTERN.test(artifactId)
  ) {
    throw new Error(`assembled artifact_id is unsafe: "${artifactId}"`);
  }
}

function hashFile(filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`artifact path must be a regular file, got ${filePath}`);
  }
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Loads and re-verifies an existing CandidateBuildMapV1 before it is reused.
 * This is the plain-Node companion to the runner's TypeScript loader: CI must
 * be able to reject a stale/tampered cache before installing dependencies or
 * invoking an expensive builder. It deliberately accepts only the existing
 * local_file V1 contract and returns the same map shape; it does not introduce
 * a second receipt or locator format.
 */
export function loadCandidateBuildMapForReuse({ mapPath, expectedSourceSha, expectedArtifactIds }) {
  if (!mapPath) {
    throw new Error("candidate build map path is required for reuse");
  }
  const sourceSha = resolveSourceSha(expectedSourceSha);
  let map;
  try {
    map = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch (error) {
    throw new Error(`candidate build map is unreadable or malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("candidate build map must be an object");
  }
  const mapKeys = Object.keys(map).sort();
  if (JSON.stringify(mapKeys) !== JSON.stringify(["artifacts", "kind", "schema_version", "source_sha"])) {
    throw new Error("candidate build map has unknown or missing fields");
  }
  if (map.schema_version !== 1 || map.kind !== "proliferate.candidate-build") {
    throw new Error("candidate build map has an unsupported schema or kind");
  }
  if (map.source_sha !== sourceSha) {
    throw new Error(`candidate build map source SHA does not match the requested source SHA`);
  }
  if (!Array.isArray(map.artifacts) || map.artifacts.length === 0) {
    throw new Error("candidate build map artifacts must be a non-empty array");
  }

  const seen = new Set();
  for (const artifact of map.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new Error("candidate build map artifact must be an object");
    }
    const keys = Object.keys(artifact).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["artifact_id", "locator", "sha256", "version"])) {
      throw new Error("candidate build map artifact has unknown or missing fields");
    }
    checkArtifactId(artifact.artifact_id);
    if (seen.has(artifact.artifact_id)) {
      throw new Error(`Duplicate artifact_id "${artifact.artifact_id}".`);
    }
    seen.add(artifact.artifact_id);
    resolveVersion(artifact.version);
    if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`candidate artifact ${artifact.artifact_id} has a malformed SHA-256`);
    }
    if (
      !artifact.locator ||
      typeof artifact.locator !== "object" ||
      Array.isArray(artifact.locator) ||
      JSON.stringify(Object.keys(artifact.locator).sort()) !== JSON.stringify(["kind", "path"]) ||
      artifact.locator.kind !== "local_file" ||
      typeof artifact.locator.path !== "string" ||
      artifact.locator.path.trim().length === 0
    ) {
      throw new Error(`candidate artifact ${artifact.artifact_id} must use a local_file locator`);
    }
    const actual = hashFile(artifact.locator.path);
    if (actual !== artifact.sha256) {
      throw new Error(`candidate artifact ${artifact.artifact_id} SHA-256 does not match its bytes`);
    }
  }

  if (expectedArtifactIds) {
    const expected = [...expectedArtifactIds].sort();
    const actual = [...seen].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`candidate build map artifact set is incompatible with the selected world`);
    }
  }
  return map;
}

/**
 * Single-binary assembler. Unchanged signature/behavior from PR #1159 so
 * existing callers (`make qualification-candidate-build-map`,
 * `make qualification-candidate-handoff-smoke`) and their tests keep working.
 */
export function assembleCandidateBuildMap({ binaryPath, sourceSha, version, target, artifactPrefix }) {
  if (!binaryPath) {
    throw new Error("--binary <path> is required");
  }
  const stats = statSync(binaryPath);
  if (!stats.isFile()) {
    throw new Error(`--binary must be a regular file, got ${binaryPath}`);
  }
  const resolvedSha = resolveSourceSha(sourceSha);
  const resolvedVersion = resolveVersion(version);
  const resolvedTarget = (target ?? rustHostTarget()).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(resolvedTarget)) {
    throw new Error(`rust target triple looks unsafe: "${resolvedTarget}"`);
  }
  const sha256 = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  const artifactId = `${artifactPrefix ?? "anyharness"}/${resolvedTarget}`;
  checkArtifactId(artifactId);
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: resolvedSha,
    artifacts: [
      {
        artifact_id: artifactId,
        version: resolvedVersion,
        sha256,
        locator: { kind: "local_file", path: path.resolve(binaryPath) },
      },
    ],
  };
}

/**
 * Multi-artifact assembler (the three-candidate local-world proof: Server
 * docker-save archive, release AnyHarness binary, Desktop renderer archive).
 * `artifacts` is a small typed list, each `{ artifactId, path, version? }`;
 * a missing per-artifact version falls back to the shared `defaultVersion`
 * (or the repository VERSION file). Every entry is independently hashed and
 * validated against the exact same rules the runner-side loader enforces, so
 * this function can never emit a map the runner would reject.
 */
export function assembleCandidateBuildMapFromArtifacts({ artifacts, sourceSha, defaultVersion }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("--artifact <id>=<path>[:<version>] is required at least once");
  }
  const resolvedSha = resolveSourceSha(sourceSha);
  const seenIds = new Set();
  const resolvedArtifacts = artifacts.map(({ artifactId, path: artifactPath, version }) => {
    if (!artifactPath) {
      throw new Error(`--artifact "${artifactId}" is missing a path`);
    }
    checkArtifactId(artifactId);
    if (seenIds.has(artifactId)) {
      throw new Error(`Duplicate artifact_id "${artifactId}".`);
    }
    seenIds.add(artifactId);
    const resolvedVersion = resolveVersion(version ?? defaultVersion);
    const sha256 = hashFile(artifactPath);
    return {
      artifact_id: artifactId,
      version: resolvedVersion,
      sha256,
      locator: { kind: "local_file", path: path.resolve(artifactPath) },
    };
  });
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: resolvedSha,
    artifacts: resolvedArtifacts,
  };
}

export function gitHeadSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
}

export function repositoryVersion() {
  return readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8");
}

export function rustHostTarget() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = output.match(/^host:\s*(\S+)$/m);
  if (!match) {
    throw new Error("could not parse host target from rustc -vV");
  }
  return match[1];
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function allArgValues(flag) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === flag) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

/**
 * Parses `<artifact-id>=<path>[:<version>]`. The path may itself contain a
 * `:` on some hosts, so only the LAST `:` after the `=` is treated as a
 * version separator, and only when what follows looks like a bounded version
 * token rather than a path fragment (i.e. contains no `/`).
 */
function parseArtifactFlag(raw) {
  const eq = raw.indexOf("=");
  if (eq <= 0) {
    throw new Error(`--artifact must look like <id>=<path>[:<version>], got "${raw}"`);
  }
  const artifactId = raw.slice(0, eq);
  const rest = raw.slice(eq + 1);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon > 0) {
    const candidateVersion = rest.slice(lastColon + 1);
    if (
      candidateVersion.length > 0 &&
      !candidateVersion.includes("/") &&
      candidateVersion.length <= MAX_VERSION_LENGTH
    ) {
      return { artifactId, path: rest.slice(0, lastColon), version: candidateVersion };
    }
  }
  return { artifactId, path: rest, version: undefined };
}

function main() {
  const outputPath = argValue("--output");
  if (!outputPath) {
    throw new Error("--output <path> is required");
  }
  const rawArtifacts = allArgValues("--artifact");
  const binaryPath = argValue("--binary");
  if (rawArtifacts.length > 0 && binaryPath) {
    throw new Error("--artifact cannot be combined with --binary; pick one mode");
  }

  const map =
    rawArtifacts.length > 0
      ? assembleCandidateBuildMapFromArtifacts({
          artifacts: rawArtifacts.map(parseArtifactFlag),
          sourceSha: argValue("--source-sha"),
          defaultVersion: argValue("--version"),
        })
      : assembleCandidateBuildMap({
          binaryPath,
          sourceSha: argValue("--source-sha"),
          version: argValue("--version"),
          target: argValue("--target"),
          artifactPrefix: argValue("--artifact-prefix"),
        });

  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  const summary = map.artifacts.map((artifact) => `${artifact.artifact_id}@${artifact.version}`).join(", ");
  console.log(`candidate build map written: ${outputPath} (${summary})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
