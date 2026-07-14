#!/usr/bin/env node
// Portable CandidateBuildMapV1 assembler
// (specs/developing/testing/candidate-build-handoff.md "Candidate build map").
// Given a built binary, computes its SHA-256 and writes the local_file-only
// candidate build map the qualification runner consumes. Defaults derive the
// source SHA from `git rev-parse HEAD`, the version from the repository
// VERSION file, and the artifact target from `rustc -vV` host.
//
// Usage:
//   node scripts/ci-cd/assemble-candidate-build-map.mjs \
//     --binary <path> --output <path> \
//     [--source-sha <40-hex>] [--version <v>] [--target <rust-triple>] \
//     [--artifact-prefix anyharness]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function assembleCandidateBuildMap({ binaryPath, sourceSha, version, target, artifactPrefix }) {
  if (!binaryPath) {
    throw new Error("--binary <path> is required");
  }
  const stats = statSync(binaryPath);
  if (!stats.isFile()) {
    throw new Error(`--binary must be a regular file, got ${binaryPath}`);
  }
  const resolvedSha = (sourceSha ?? gitHeadSha()).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolvedSha)) {
    throw new Error(`source SHA must be a lowercase 40-hex commit SHA, got "${resolvedSha}"`);
  }
  const resolvedVersion = (version ?? repositoryVersion()).trim();
  if (resolvedVersion.length === 0 || resolvedVersion.length > 128) {
    throw new Error("version must be non-empty and bounded");
  }
  const resolvedTarget = (target ?? rustHostTarget()).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(resolvedTarget)) {
    throw new Error(`rust target triple looks unsafe: "${resolvedTarget}"`);
  }
  const sha256 = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: resolvedSha,
    artifacts: [
      {
        artifact_id: `${artifactPrefix ?? "anyharness"}/${resolvedTarget}`,
        version: resolvedVersion,
        sha256,
        locator: { kind: "local_file", path: path.resolve(binaryPath) },
      },
    ],
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

function main() {
  const outputPath = argValue("--output");
  if (!outputPath) {
    throw new Error("--output <path> is required");
  }
  const map = assembleCandidateBuildMap({
    binaryPath: argValue("--binary"),
    sourceSha: argValue("--source-sha"),
    version: argValue("--version"),
    target: argValue("--target"),
    artifactPrefix: argValue("--artifact-prefix"),
  });
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  console.log(
    `candidate build map written: ${outputPath} (${map.artifacts[0].artifact_id}@${map.artifacts[0].version})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
