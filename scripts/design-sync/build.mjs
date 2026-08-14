#!/usr/bin/env node
/**
 * Design-sync payload orchestrator. Runs every stage in dependency order and
 * leaves a complete uploadable payload in scripts/design-sync/.out/.
 *
 * Stages (each also runnable standalone):
 *   0. pnpm --filter @proliferate/design build   (token authority -> dist)
 *   0b. dump-registry.mjs    -> .out/.ds-registry-manifest.json (compiles and
 *                               executes LIBRARY_TIERS; every later stage
 *                               reads the registry from this dump)
 *   1. make-entry.mjs        -> .out/.ds-entry.tsx
 *   2. build-vendor-react.mjs-> .out/_vendor/react.js (+ stub)
 *   3. build-bundle.mjs      -> .out/_ds_bundle.js
 *   4. build-css.mjs         -> .out/_ds_bundle.css, .out/styles.css, .out/fonts/
 *   5. emit-cards.mjs        -> .out/_preview/, .out/components/
 *   6. make-meta.mjs         -> .out/_ds_sync.json, .ds-build-meta.json,
 *                               _ds_needs_recompile, README.md   (ALWAYS LAST:
 *                               hashes the final bytes of every other artifact)
 *   7. render-check.mjs      -> .render-check.json, .review.html, _screenshots/
 *
 * Upload is NOT part of this script: it runs through the DesignSync tool in a
 * Claude Code session (see CONTRACT.md for the choreography).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const run = (cmd, args, opts = {}) => {
  console.log(`\n▶ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repo, ...opts });
};

const skipCheck = process.argv.includes("--no-check");

// Always rebuild the design package: dist/ is the token authority for the
// CSS stage, and a presence-only check would silently ship stale tokens
// after a src/tokens.ts edit. The build is cheap (tsc + node scripts).
run("pnpm", ["--filter", "@proliferate/design", "build"], {
  env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
});

run("node", [join(here, "dump-registry.mjs")]);
run("node", [join(here, "make-entry.mjs")]);
run("node", [join(here, "build-vendor-react.mjs")]);
run("node", [join(here, "build-bundle.mjs")]);
run("node", [join(here, "build-css.mjs")]);
run("node", [join(here, "emit-cards.mjs")]);
run("node", [join(here, "make-meta.mjs")]);
if (!skipCheck) run("node", [join(here, "render-check.mjs")]);

console.log("\n✔ payload complete: scripts/design-sync/.out/");
