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
  {
    key: "windows-x86_64",
    // "windows-x86_64" is the exact platform key Tauri v2's updater expects
    // for this target: it follows the same <os>-<arch> shape as the darwin-*
    // keys above, and apps/desktop/src-tauri/tauri.conf.json already carries
    // an updater.windows block for this same build. The artifact matched
    // here is the NSIS setup.exe, not the MSI: it is what Tauri's updater
    // downloads and verifies, and per release-desktop.yml's publish-updater
    // job only "*-setup.exe"/"*-setup.exe.sig" (not "*.msi") are copied to
    // the downloads bucket this manifest's --base-url points at. The
    // "-setup.exe" suffix is what separates this platform from darwin-x86_64
    // under the filename-only matching above; no directory segment is
    // required, so a flat extraction resolves it just as well as a nested one.
    // Optional: the Windows leg is an opt-in beta gated behind release.yml's
    // enable_windows_beta input (defaulted false), so a missing or failed
    // Windows build must never fail a mac-only release.
    optional: true,
    artifactMatcher: (relPath, name) => /(x64|x86_64).*-setup\.exe$/i.test(name),
    sigMatcher: (relPath, name) => /(x64|x86_64).*-setup\.exe\.sig$/i.test(name),
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
    // Only a fully absent optional platform is a silent skip. A platform
    // with just one of the two present is never skipped, optional or not: a
    // signed updater feed must never carry an unsigned entry, and a
    // signature with no matching artifact is equally a broken publish.
    if (platform.optional && sigFiles.length === 0 && artifactFiles.length === 0) {
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
