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

const args = parseArgs();
const version = args.version;
const artifactsDir = args["artifacts-dir"];
const baseUrl = args["base-url"];
const output = args.output;
const rawNotes = args.notes;
const validateNotesOnly = args["validate-notes-only"] === "true";

const MAX_NOTES_LENGTH = 80;

function normalizeNotes(value) {
  if (value === undefined) return undefined;
  if (/[\r\n\u2028\u2029]/u.test(value)) {
    throw new Error("release title must be a single line");
  }

  const notes = value.trim();
  if (!notes) return undefined;
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(notes)) {
    throw new Error("release title must not contain control characters");
  }
  if (Array.from(notes).length > MAX_NOTES_LENGTH) {
    throw new Error(`release title must be at most ${MAX_NOTES_LENGTH} characters`);
  }
  return notes;
}

let notes;
try {
  notes = normalizeNotes(rawNotes);
} catch (error) {
  console.error(`Invalid --notes: ${error.message}`);
  process.exit(1);
}

if (validateNotesOnly) {
  console.log(notes ? `Release title: ${notes}` : "Release title omitted");
  process.exit(0);
}

if (!version || !artifactsDir || !baseUrl || !output) {
  console.error("Usage: generate-updater-manifest.mjs --version <ver> --artifacts-dir <dir> --base-url <url> --output <file> [--notes <title>] [--validate-notes-only true]");
  process.exit(1);
}

// Platform mapping: Tauri platform key -> artifact filename patterns.
// Matchers test filenames only, never directory layout: download-artifact@v8
// nests each artifact in a directory named after it when several artifacts
// match the pattern, but extracts FLAT when exactly one matches (or when
// merge-multiple is set). Requiring a path segment here is what broke the
// 0.4.22 publish after the paused Intel lane left a single artifact.
const platforms = [
  {
    key: "darwin-aarch64",
    artifactMatcher: (relPath, name) =>
      /(aarch64|arm64).*\.app\.tar\.gz$/i.test(name),
    sigMatcher: (relPath, name) =>
      /(aarch64|arm64).*\.app\.tar\.gz\.sig$/i.test(name),
  },
  {
    key: "darwin-x86_64",
    // Intel desktop builds are paused 2026-08-20 (release-desktop.yml
    // build-desktop matrix), so this platform's artifacts are expected to be
    // absent from every run until they resume. Optional: a missing Intel
    // artifact is not a manifest-generation failure.
    optional: true,
    artifactMatcher: (relPath, name) =>
      /(x64|x86_64).*\.app\.tar\.gz$/i.test(name),
    sigMatcher: (relPath, name) =>
      /(x64|x86_64).*\.app\.tar\.gz\.sig$/i.test(name),
  },
];

const manifest = {
  version,
  ...(notes ? { notes } : {}),
  pub_date: new Date().toISOString(),
  platforms: {},
};

const errors = [];

for (const platform of platforms) {
  const sigFiles = findFiles(artifactsDir, platform.sigMatcher);
  const artifactFiles = findFiles(artifactsDir, platform.artifactMatcher);

  if (sigFiles.length === 0 || artifactFiles.length === 0) {
    if (platform.optional) {
      console.warn(`Skipping ${platform.key}: no artifacts found (optional platform).`);
      continue;
    }
    if (sigFiles.length === 0) errors.push(`Missing signature file for ${platform.key}`);
    if (artifactFiles.length === 0) errors.push(`Missing artifact file for ${platform.key}`);
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
