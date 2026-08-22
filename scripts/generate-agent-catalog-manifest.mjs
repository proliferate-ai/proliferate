#!/usr/bin/env node
// Builds the publisher-lane rolling manifest for the agent catalog+registry
// artifact (Update Flow ADR, FR-1). Mirrors generate-updater-manifest.mjs's
// skeleton: read inputs, compute sha256 for each named file, write one JSON
// manifest the CI publish job then signs and uploads unmodified. This script
// never signs anything itself — minisign signing happens as a separate CI
// step against the checked-out `catalog.json`/`registry.json` bytes, using
// secrets this script has no access to.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  }
  return args;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildManifest({ catalogPath, registryPath }) {
  const catalogBytes = readFileSync(catalogPath);
  const registryBytes = readFileSync(registryPath);

  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const registry = JSON.parse(registryBytes.toString("utf8"));

  if (!catalog.catalogVersion || typeof catalog.catalogVersion !== "string") {
    throw new Error(`${catalogPath} is missing a string catalogVersion`);
  }
  if (!registry.registryVersion || typeof registry.registryVersion !== "string") {
    throw new Error(`${registryPath} is missing a string registryVersion`);
  }
  if (!catalog.generatedAt || typeof catalog.generatedAt !== "string") {
    throw new Error(`${catalogPath} is missing a string generatedAt`);
  }
  // RFC3339 sanity: the runtime compares this instant, never the dotted
  // version string, to decide staged-vs-bundled activation. A manifest with
  // an unparseable timestamp would silently never activate.
  if (Number.isNaN(Date.parse(catalog.generatedAt))) {
    throw new Error(`${catalogPath}'s generatedAt is not a parseable timestamp: ${catalog.generatedAt}`);
  }

  return {
    catalogVersion: catalog.catalogVersion,
    registryVersion: registry.registryVersion,
    generatedAt: catalog.generatedAt,
    files: {
      [path.basename(catalogPath)]: { sha256: sha256Hex(catalogBytes) },
      [path.basename(registryPath)]: { sha256: sha256Hex(registryBytes) },
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { catalog, registry, output } = args;

  if (!catalog || !registry || !output) {
    console.error(
      "Usage: generate-agent-catalog-manifest.mjs --catalog <catalog.json> --registry <registry.json> --output <manifest.json>",
    );
    process.exit(1);
  }

  const manifest = buildManifest({ catalogPath: catalog, registryPath: registry });
  writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Generated ${output}: catalogVersion=${manifest.catalogVersion} registryVersion=${manifest.registryVersion}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
