#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const DOCUMENTS = [
  {
    label: "agent catalog",
    path: "catalogs/agents/catalog.json",
    versionKey: "catalogVersion",
  },
  {
    label: "agent registry",
    path: "catalogs/agents/registry.json",
    versionKey: "registryVersion",
  },
];

export function parseVersion(version) {
  const match = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(version ?? "");
  if (!match) return null;
  return { date: match[1], revision: Number(match[2]) };
}

export function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return null;
  if (leftVersion.date !== rightVersion.date) {
    return leftVersion.date.localeCompare(rightVersion.date);
  }
  return leftVersion.revision - rightVersion.revision;
}

export function checkDocumentVersion({ label, current, base, versionKey }) {
  const errors = [];
  const currentVersion = current?.[versionKey];
  const baseVersion = base?.[versionKey];
  if (!parseVersion(currentVersion)) {
    errors.push(`${label}: ${versionKey} '${currentVersion}' must use YYYY-MM-DD.revision`);
    return errors;
  }
  if (!parseVersion(baseVersion)) {
    errors.push(`${label}: base ${versionKey} '${baseVersion}' must use YYYY-MM-DD.revision`);
    return errors;
  }

  const currentContent = structuredClone(current);
  const baseContent = structuredClone(base);
  delete currentContent[versionKey];
  delete baseContent[versionKey];
  const contentChanged = !isDeepStrictEqual(currentContent, baseContent);
  if (contentChanged && currentVersion === baseVersion) {
    errors.push(`${label}: content changed without bumping ${versionKey}`);
  }
  if (currentVersion !== baseVersion && compareVersions(currentVersion, baseVersion) <= 0) {
    errors.push(
      `${label}: ${versionKey} must increase (${baseVersion} -> ${currentVersion})`,
    );
  }
  return errors;
}

function parseArgs(argv) {
  const result = { base: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base") {
      result.base = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`unexpected argument ${argv[index]}`);
    }
  }
  return result;
}

function readAtRevision(revision, filePath) {
  return JSON.parse(
    execFileSync("git", ["show", `${revision}:${filePath}`], { encoding: "utf8" }),
  );
}

function main() {
  const { base } = parseArgs(process.argv.slice(2));
  if (!base) {
    console.log("catalog version discipline skipped: no base revision supplied");
    return;
  }
  const errors = [];
  for (const document of DOCUMENTS) {
    const current = JSON.parse(readFileSync(document.path, "utf8"));
    const baseDocument = readAtRevision(base, document.path);
    errors.push(...checkDocumentVersion({
      label: document.label,
      current,
      base: baseDocument,
      versionKey: document.versionKey,
    }));
  }
  if (errors.length) {
    for (const error of errors) console.error(`catalog version discipline failed: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`catalog version discipline OK against ${base}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
