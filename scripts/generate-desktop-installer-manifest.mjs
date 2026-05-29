#!/usr/bin/env node

import { writeFileSync, readdirSync } from "fs";
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
  console.error("Usage: generate-desktop-installer-manifest.mjs --version <ver> --artifacts-dir <dir> --base-url <url> --output <file>");
  process.exit(1);
}

const downloads = [
  {
    key: "darwin-aarch64",
    matcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-aarch64-apple-darwin") &&
      /(aarch64|arm64).*\.dmg$/i.test(name),
  },
  {
    key: "darwin-x86_64",
    matcher: (relPath, name) =>
      pathIncludes(relPath, "desktop-x86_64-apple-darwin") &&
      /(x64|x86_64).*\.dmg$/i.test(name),
  },
];

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  downloads: {},
};

const errors = [];

for (const download of downloads) {
  const files = findFiles(artifactsDir, download.matcher);

  if (files.length === 0) {
    errors.push(`Missing installer file for ${download.key}`);
    continue;
  }

  const artifactName = basename(files[0]);
  manifest.downloads[download.key] = {
    url: `${baseUrl}/${artifactName}`,
  };
}

if (errors.length > 0) {
  console.error("Installer manifest generation failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${output} for version ${version} with ${Object.keys(manifest.downloads).length} downloads`);
