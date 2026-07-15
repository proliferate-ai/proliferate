#!/usr/bin/env node
// Build-time asset emission for @proliferate/product-client.
//
// The package build is `tsc` (JS + d.ts only). It does NOT copy the non-code
// resources the moved product tree references, so two steps run around it:
//
//   1. sync-generated (default, runs before tsc): copies the repo-root agent
//      catalog (`catalogs/agents/catalog.json`) into the gitignored
//      `src/generated/agent-catalog.json`. `bundled-agent-catalog.ts` imports
//      that copy package-relatively (`?raw`) instead of reaching six levels up
//      into the repo root — no checked-in duplicate, no cross-package reach.
//
//   2. --dist (runs after tsc): mirrors every non-TypeScript file under `src/`
//      (index.css, svg/png/jpeg/mp3 assets, the generated catalog, committed
//      config JSON) into the emitted `dist/` tree so the two host Vite builds
//      resolve the asset/catalog URLs from the package's published output.
//
// Idempotent; safe to run repeatedly. Exits nonzero on a missing source.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = join(PKG_DIR, "..", "..", "..");
const SRC_DIR = join(PKG_DIR, "src");
const DIST_DIR = join(PKG_DIR, "dist");

const CATALOG_SOURCE = join(REPO_ROOT, "catalogs", "agents", "catalog.json");
const GENERATED_DIR = join(SRC_DIR, "generated");
const CATALOG_DEST = join(GENERATED_DIR, "agent-catalog.json");

const emitDist = process.argv.includes("--dist");

function syncGeneratedCatalog() {
  if (!existsSync(CATALOG_SOURCE)) {
    // Pruned build contexts (e.g. the Vercel web deploy ignores /catalogs)
    // install workspace packages without needing product-client's assets.
    // Keep an already-synced copy if present; otherwise skip with a warning —
    // the desktop/browser host builds always run from a full checkout.
    if (existsSync(CATALOG_DEST)) return;
    console.warn(
      `[copy-product-client-assets] catalog source missing (pruned checkout?): ${CATALOG_SOURCE} — skipping sync`,
    );
    return;
  }
  mkdirSync(GENERATED_DIR, { recursive: true });
  cpSync(CATALOG_SOURCE, CATALOG_DEST);
  console.log(
    `[copy-product-client-assets] synced agent catalog -> ${relative(REPO_ROOT, CATALOG_DEST)}`,
  );
}

function mirrorNonCodeAssetsToDist() {
  if (!existsSync(DIST_DIR)) {
    console.error(
      `[copy-product-client-assets] --dist requested but ${relative(REPO_ROOT, DIST_DIR)} does not exist (run tsc first)`,
    );
    process.exit(1);
  }

  let copied = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        continue;
      }
      const dest = join(DIST_DIR, relative(SRC_DIR, abs));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(abs, dest);
      copied += 1;
    }
  };
  walk(SRC_DIR);
  console.log(
    `[copy-product-client-assets] mirrored ${copied} non-code asset(s) src -> dist`,
  );
}

syncGeneratedCatalog();
if (emitDist) {
  mirrorNonCodeAssetsToDist();
}
