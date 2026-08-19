#!/usr/bin/env node
// Build-time asset emission for @proliferate/product-client.
//
// The package build is `tsc` (JS + d.ts only). It does NOT copy the non-code
// resources the moved product tree references, so two steps run around it:
//
//   1. sync-generated (default, runs before tsc): copies the repo-root agent
//      registry into the gitignored `src/generated/agent-registry.json`.
//
//   2. --dist (runs after tsc): mirrors every non-TypeScript file under `src/`
//      (index.css, svg/png/jpeg/wav assets, the generated registry, committed
//      config JSON) into the emitted `dist/` tree so the two host Vite builds
//      resolve the asset/catalog URLs from the package's published output.
//
// Idempotent; safe to run repeatedly. Exits nonzero on a missing source.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = join(PKG_DIR, "..", "..", "..");
const SRC_DIR = join(PKG_DIR, "src");
const DIST_DIR = join(PKG_DIR, "dist");

const REGISTRY_SOURCE = join(REPO_ROOT, "catalogs", "agents", "registry.json");
const GENERATED_DIR = join(SRC_DIR, "generated");
const REGISTRY_DEST = join(GENERATED_DIR, "agent-registry.json");
const RETIRED_EXECUTABLE_CATALOG_DEST = join(GENERATED_DIR, "agent-catalog.json");

const emitDist = process.argv.includes("--dist");

function syncGeneratedDocument(source, dest, label) {
  if (!existsSync(source)) {
    // Pruned build contexts (e.g. the Vercel web deploy ignores /catalogs)
    // install workspace packages without needing product-client's assets.
    // Keep an already-synced copy if present; otherwise skip with a warning —
    // the desktop/browser host builds always run from a full checkout.
    if (existsSync(dest)) return;
    console.warn(
      `[copy-product-client-assets] ${label} source missing (pruned checkout?): ${source} — skipping sync`,
    );
    return;
  }
  mkdirSync(GENERATED_DIR, { recursive: true });
  // Minify: the copies are inlined `?raw` into the /login entry chunk, and the
  // pretty-printed sources cost ~2.6KB extra gzip against the WDU-1247-D1 cap.
  writeFileSync(
    dest,
    JSON.stringify(JSON.parse(readFileSync(source, "utf8"))),
  );
  console.log(
    `[copy-product-client-assets] synced ${label} (minified) -> ${relative(REPO_ROOT, dest)}`,
  );
}

function syncGeneratedCatalog() {
  syncGeneratedDocument(REGISTRY_SOURCE, REGISTRY_DEST, "agent registry");
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
      if (abs === RETIRED_EXECUTABLE_CATALOG_DEST) {
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
