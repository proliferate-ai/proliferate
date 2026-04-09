#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename, relative } from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    parsed[args[i].replace(/^--/, "")] = args[i + 1];
  }
  return parsed;
}

function findFiles(dir, matcher) {
  const files = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (matcher(relative(dir, full), entry.name)) files.push(full);
    }
  }
  walk(dir);
  return files;
}

function pathIncludes(relPath, segment) {
  return relPath.split("/").includes(segment);
}

const args = parseArgs();
const version = args.version;
const artifactsDir = args["artifacts-dir"];
const baseUrl = args["base-url"];
const output = args.output;

if (!version || !artifactsDir || !baseUrl || !output) {
  console.error("Usage: generate-updater-manifest.mjs --version <ver> --artifacts-dir <dir> --base-url <url> --output <file>");
  process.exit(1);
}

// Platform mapping: Tauri platform key -> artifact patterns
const platforms = [
  {
    key: "darwin-aarch64",
    artifactMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-aarch64-apple-darwin") &&
      /(aarch64|arm64).*\.app\.tar\.gz$/i.test(name),
    sigMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-aarch64-apple-darwin") &&
      /(aarch64|arm64).*\.app\.tar\.gz\.sig$/i.test(name),
  },
  {
    key: "darwin-x86_64",
    artifactMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-x86_64-apple-darwin") &&
      /(x64|x86_64).*\.app\.tar\.gz$/i.test(name),
    sigMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-x86_64-apple-darwin") &&
      /(x64|x86_64).*\.app\.tar\.gz\.sig$/i.test(name),
  },
  {
    key: "windows-x86_64",
    artifactMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-x86_64-pc-windows-msvc") &&
      /(x64|x86_64).*setup\.exe$/i.test(name),
    sigMatcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-x86_64-pc-windows-msvc") &&
      /(x64|x86_64).*setup\.exe\.sig$/i.test(name),
  },
];

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {},
};

const errors = [];

for (const platform of platforms) {
  const sigFiles = findFiles(artifactsDir, platform.sigMatcher);
  const artifactFiles = findFiles(artifactsDir, platform.artifactMatcher);

  if (sigFiles.length === 0) {
    errors.push(`Missing signature file for ${platform.key}`);
    continue;
  }
  if (artifactFiles.length === 0) {
    errors.push(`Missing artifact file for ${platform.key}`);
    continue;
  }

  const signature = readFileSync(sigFiles[0], "utf-8").trim();
  const artifactName = basename(artifactFiles[0]);

  manifest.platforms[platform.key] = {
    signature,
    url: `${baseUrl}/${artifactName}`,
  };
}

if (errors.length > 0) {
  console.error("Manifest generation failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${output} for version ${version} with ${Object.keys(manifest.platforms).length} platforms`);
