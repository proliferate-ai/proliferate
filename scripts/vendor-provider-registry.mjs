#!/usr/bin/env node
// Vendors the models.dev provider catalog into a small, UI-only suggestion
// list for the desktop app's OpenCode "Add provider" picker (contract §6).
//
// Refresh: node scripts/vendor-provider-registry.mjs
// (re-run whenever OpenCode-supported providers change upstream; the output
// below is checked in, there is no build-time fetch).

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  repoRoot,
  "apps/desktop/src/config/provider-registry.generated.json",
);
const sourceUrl = "https://models.dev/api.json";

async function fetchProviders() {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function reduceProviders(raw) {
  const providers = [];

  for (const provider of Object.values(raw)) {
    const envVarNames = Array.isArray(provider.env) ? provider.env.filter(Boolean) : [];
    if (envVarNames.length === 0) continue;

    const entry = {
      id: provider.id,
      displayName: provider.name ?? provider.id,
      envVarNames,
    };
    if (typeof provider.npm === "string" && provider.npm) {
      entry.npm = provider.npm;
    }
    providers.push(entry);
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  return providers;
}

async function main() {
  const raw = await fetchProviders();
  const providers = reduceProviders(raw);
  writeFileSync(outputPath, `${JSON.stringify(providers, null, 2)}\n`);
  console.log(`Wrote ${providers.length} providers to ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
