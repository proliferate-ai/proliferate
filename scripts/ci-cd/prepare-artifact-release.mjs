#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSurfaceList } from "./detect-deploy-surfaces.mjs";

const ARTIFACT_SURFACES = new Set(["desktop", "runtime", "server"]);
const SHA_ONLY_SURFACES = new Set(["workers", "e2b", "web"]);
const PRODUCT_TAG_PREFIX = "proliferate-v";

function parseArgs(argv) {
  const parsed = {
    surfaces: "",
    releaseId: "",
    versionBump: "patch",
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
      case "--version-bump":
        parsed.versionBump = argv[index + 1] || "";
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
  console.log(`Prepare product and artifact lane versions for a release train or hotfix.

Usage:
  node scripts/ci-cd/prepare-artifact-release.mjs --surfaces <csv|all> --release-id <id> --version-bump <patch|minor|major|none> --dry-run <true|false>

Writes GitHub outputs for the public Proliferate product version and selected
desktop/runtime/server artifact versions and tags. When a version bump is
requested and --dry-run=false, updates VERSION plus tracked artifact version
files for selected lanes that require committed version metadata.
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

export function incrementMinor(value) {
  const [major, minor] = parseVersion(value);
  return `${major}.${minor + 1}.0`;
}

export function incrementMajor(value) {
  const [major] = parseVersion(value);
  return `${major + 1}.0.0`;
}

export function nextVersion(currentVersion, latestTagVersion = "", versionBump = "patch") {
  if (versionBump === "none") {
    return currentVersion;
  }
  if (!["patch", "minor", "major"].includes(versionBump)) {
    throw new Error(`Unsupported version bump: ${versionBump}`);
  }
  if (!latestTagVersion) {
    return incrementVersion(currentVersion, versionBump);
  }
  const base = compareVersions(currentVersion, latestTagVersion) >= 0 ? currentVersion : latestTagVersion;
  return incrementVersion(base, versionBump);
}

export function nextPatchVersion(currentVersion, latestTagVersion = "") {
  return nextVersion(currentVersion, latestTagVersion, "patch");
}

function incrementVersion(value, versionBump) {
  if (versionBump === "patch") return incrementPatch(value);
  if (versionBump === "minor") return incrementMinor(value);
  if (versionBump === "major") return incrementMajor(value);
  throw new Error(`Unsupported version bump: ${versionBump}`);
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

function readText(file) {
  return fs.readFileSync(file, "utf8").trim();
}

function writeText(file, value, dryRun) {
  if (!dryRun) {
    fs.writeFileSync(file, `${value}\n`);
  }
  return true;
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

function readProductVersion(root) {
  const version = readText(path.join(root, "VERSION"));
  parseVersion(version);
  return version;
}

function updateProductVersion(root, version, dryRun) {
  return writeText(path.join(root, "VERSION"), version, dryRun) ? ["VERSION"] : [];
}

function validateVersionBumpForSurfaces({ surfaces, versionBump }) {
  if (!["patch", "minor", "major", "none"].includes(versionBump)) {
    throw new Error(`Unsupported version bump: ${versionBump}`);
  }
  if (versionBump !== "none") {
    return;
  }
  const invalid = [...surfaces].filter((surface) => !SHA_ONLY_SURFACES.has(surface));
  if (invalid.length > 0) {
    throw new Error(`version_bump=none is only allowed for SHA-based surfaces, not: ${invalid.join(", ")}`);
  }
}

function productVersionPlan({ root, surfaces, versionBump, dryRun, latestProductTagVersion }) {
  if (surfaces.size === 0) {
    return {
      currentVersion: readProductVersion(root),
      version: "",
      tag: "",
      changedFiles: [],
    };
  }

  validateVersionBumpForSurfaces({ surfaces, versionBump });
  const currentVersion = readProductVersion(root);
  if (versionBump === "none") {
    return {
      currentVersion,
      version: currentVersion,
      tag: "",
      changedFiles: [],
    };
  }

  const version = nextVersion(currentVersion, latestProductTagVersion, versionBump);
  const changedFiles = version !== currentVersion ? updateProductVersion(root, version, dryRun) : [];
  return {
    currentVersion,
    version,
    tag: `${PRODUCT_TAG_PREFIX}${version}`,
    changedFiles,
  };
}

function artifactTagMap({ root, surfaces, productVersion, dryRun }) {
  const tags = {};
  const versions = {};
  const changedFiles = [];

  if (surfaces.has("desktop")) {
    const current = readDesktopVersion(root);
    versions.desktop = productVersion;
    tags.desktop = `desktop-v${productVersion}`;
    if (productVersion !== current) {
      changedFiles.push(...updateDesktopVersion(root, productVersion, dryRun));
    }
  }

  if (surfaces.has("runtime")) {
    const current = readRuntimeVersion(root);
    versions.runtime = productVersion;
    tags.runtime = `runtime-v${productVersion}`;
    if (productVersion !== current) {
      changedFiles.push(...updateRuntimeVersion(root, productVersion, dryRun));
    }
  }

  if (surfaces.has("server")) {
    versions.server = productVersion;
    tags.server = `server-v${productVersion}`;
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
    `product_version=${plan.productVersion}`,
    `product_tag=${plan.productTag}`,
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

export function buildArtifactPlan({
  root,
  surfaces,
  releaseId,
  versionBump,
  dryRun,
  latestProductTagVersion = latestVersionForPrefix(PRODUCT_TAG_PREFIX),
}) {
  validateVersionBumpForSurfaces({ surfaces, versionBump });
  const product = productVersionPlan({
    root,
    surfaces,
    versionBump,
    dryRun,
    latestProductTagVersion,
  });
  const selectedSurfaces = [...surfaces].filter((surface) => ARTIFACT_SURFACES.has(surface));
  const artifact = artifactTagMap({
    root,
    surfaces: new Set(selectedSurfaces),
    productVersion: product.version,
    dryRun,
  });
  return {
    releaseId,
    versionBump,
    dryRun,
    productVersion: product.version,
    productTag: product.tag,
    selectedSurfaces: [...surfaces],
    tags: artifact.tags,
    versions: artifact.versions,
    changedFiles: [...new Set([...product.changedFiles, ...artifact.changedFiles])],
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
    versionBump: parsed.versionBump,
    dryRun: parsed.dryRun,
  });
  writeGithubOutput(plan);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
