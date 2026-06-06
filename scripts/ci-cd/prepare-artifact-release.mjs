#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSurfaceList } from "./detect-deploy-surfaces.mjs";

const ARTIFACT_SURFACES = new Set(["desktop", "runtime", "server"]);

function parseArgs(argv) {
  const parsed = {
    surfaces: "",
    releaseId: "",
    bumpPatch: false,
    dryRun: false,
    root: process.cwd(),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--surfaces":
        parsed.surfaces = argv[index + 1] || "";
        index += 1;
        break;
      case "--release-id":
        parsed.releaseId = argv[index + 1] || "";
        index += 1;
        break;
      case "--bump-patch":
        parsed.bumpPatch = parseBoolean(argv[index + 1] || "false");
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = parseBoolean(argv[index + 1] || "false");
        index += 1;
        break;
      case "--root":
        parsed.root = argv[index + 1] || "";
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`Prepare artifact lane versions for a release train or hotfix.

Usage:
  node scripts/ci-cd/prepare-artifact-release.mjs --surfaces <csv|all> --release-id <id> --bump-patch <true|false> --dry-run <true|false>

Writes GitHub outputs for desktop/runtime/server versions and tags. When
--bump-patch=true and --dry-run=false, updates tracked version files for lanes
that require committed version metadata.
`);
}

function parseBoolean(value) {
  return ["1", "true", "yes"].includes(String(value).toLowerCase());
}

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported semver version: ${value}`);
  }
  return match.slice(1).map((part) => Number(part));
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

export function incrementPatch(value) {
  const [major, minor, patch] = parseVersion(value);
  return `${major}.${minor}.${patch + 1}`;
}

export function nextPatchVersion(currentVersion, latestTagVersion = "") {
  if (!latestTagVersion) {
    return incrementPatch(currentVersion);
  }
  const base = compareVersions(currentVersion, latestTagVersion) >= 0 ? currentVersion : latestTagVersion;
  return incrementPatch(base);
}

export function tagVersion(tag, prefix) {
  if (!tag.startsWith(prefix)) {
    return "";
  }
  const version = tag.slice(prefix.length);
  return /^\d+\.\d+\.\d+$/.test(version) ? version : "";
}

export function latestVersionFromTags(tags, prefix) {
  return tags
    .map((tag) => tagVersion(tag, prefix))
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left))[0] || "";
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function remoteTags(prefix) {
  try {
    const output = git(["ls-remote", "--tags", "origin", `refs/tags/${prefix}*`]);
    return output
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[1] || "")
      .filter(Boolean)
      .map((ref) => ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""));
  } catch {
    return [];
  }
}

function localTags(prefix) {
  try {
    return git(["tag", "--list", `${prefix}*`]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function latestVersionForPrefix(prefix) {
  return latestVersionFromTags([...new Set([...remoteTags(prefix), ...localTags(prefix)])], prefix);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value, dryRun) {
  if (!dryRun) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  return true;
}

function replaceCargoVersion(file, version, dryRun) {
  const source = fs.readFileSync(file, "utf8");
  const updated = source.replace(/^version = "([^"]+)"/m, `version = "${version}"`);
  if (source === updated) {
    throw new Error(`Could not update Cargo version in ${file}`);
  }
  if (!dryRun) {
    fs.writeFileSync(file, updated);
  }
  return true;
}

function readDesktopVersion(root) {
  const packageJson = readJson(path.join(root, "apps/desktop/package.json"));
  const tauriConfig = readJson(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"));
  const cargoToml = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = /^version = "([^"]+)"/m.exec(cargoToml)?.[1] || "";
  if (packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
    throw new Error(
      `Desktop version mismatch: package=${packageJson.version} tauri=${tauriConfig.version} cargo=${cargoVersion}`,
    );
  }
  return packageJson.version;
}

function updateDesktopVersion(root, version, dryRun) {
  const packagePath = path.join(root, "apps/desktop/package.json");
  const tauriPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
  const cargoPath = path.join(root, "apps/desktop/src-tauri/Cargo.toml");
  const packageJson = readJson(packagePath);
  const tauriConfig = readJson(tauriPath);
  packageJson.version = version;
  tauriConfig.version = version;
  const changed = [];
  if (writeJson(packagePath, packageJson, dryRun)) changed.push("apps/desktop/package.json");
  if (writeJson(tauriPath, tauriConfig, dryRun)) changed.push("apps/desktop/src-tauri/tauri.conf.json");
  if (replaceCargoVersion(cargoPath, version, dryRun)) changed.push("apps/desktop/src-tauri/Cargo.toml");
  return changed;
}

function readRuntimeVersion(root) {
  return readJson(path.join(root, "anyharness/sdk/package.json")).version;
}

function updateRuntimeVersion(root, version, dryRun) {
  const packagePath = path.join(root, "anyharness/sdk/package.json");
  const packageJson = readJson(packagePath);
  packageJson.version = version;
  return writeJson(packagePath, packageJson, dryRun) ? ["anyharness/sdk/package.json"] : [];
}

function artifactTagMap({ root, surfaces, bumpPatch, dryRun }) {
  const tags = {};
  const versions = {};
  const changedFiles = [];

  if (surfaces.has("desktop")) {
    const current = readDesktopVersion(root);
    const version = bumpPatch ? nextPatchVersion(current, latestVersionForPrefix("desktop-v")) : current;
    versions.desktop = version;
    tags.desktop = `desktop-v${version}`;
    if (bumpPatch && version !== current) {
      changedFiles.push(...updateDesktopVersion(root, version, dryRun));
    }
  }

  if (surfaces.has("runtime")) {
    const current = readRuntimeVersion(root);
    const version = bumpPatch ? nextPatchVersion(current, latestVersionForPrefix("runtime-v")) : current;
    versions.runtime = version;
    tags.runtime = `runtime-v${version}`;
    if (bumpPatch && version !== current) {
      changedFiles.push(...updateRuntimeVersion(root, version, dryRun));
    }
  }

  if (surfaces.has("server")) {
    const latest = latestVersionForPrefix("server-v") || "0.1.0";
    const version = bumpPatch ? incrementPatch(latest) : latest;
    versions.server = version;
    tags.server = `server-v${version}`;
  }

  return { tags, versions, changedFiles };
}

function writeGithubOutput(plan) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  const lines = [
    `release_id=${plan.releaseId}`,
    `selected_surfaces=${plan.selectedSurfaces.join(",")}`,
    `artifact_tags=${Object.values(plan.tags).filter(Boolean).join(",")}`,
    `artifact_tags_json=${JSON.stringify(plan.tags)}`,
    `changed_files_json=${JSON.stringify(plan.changedFiles)}`,
  ];
  for (const surface of ["desktop", "runtime", "server"]) {
    lines.push(`${surface}_version=${plan.versions[surface] || ""}`);
    lines.push(`${surface}_tag=${plan.tags[surface] || ""}`);
  }
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

export function buildArtifactPlan({ root, surfaces, releaseId, bumpPatch, dryRun }) {
  const selectedSurfaces = [...surfaces].filter((surface) => ARTIFACT_SURFACES.has(surface));
  const artifact = artifactTagMap({
    root,
    surfaces: new Set(selectedSurfaces),
    bumpPatch,
    dryRun,
  });
  return {
    releaseId,
    bumpPatch,
    dryRun,
    selectedSurfaces,
    tags: artifact.tags,
    versions: artifact.versions,
    changedFiles: [...new Set(artifact.changedFiles)],
  };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!parsed.releaseId) {
    throw new Error("--release-id is required.");
  }

  const surfaces = parseSurfaceList(parsed.surfaces, "artifact");
  const plan = buildArtifactPlan({
    root: path.resolve(parsed.root),
    surfaces,
    releaseId: parsed.releaseId,
    bumpPatch: parsed.bumpPatch,
    dryRun: parsed.dryRun,
  });
  writeGithubOutput(plan);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
