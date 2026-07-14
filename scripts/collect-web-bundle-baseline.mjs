#!/usr/bin/env node
// Deterministic legacy-Web bundle baseline collector.
//
// Produces the provisional performance baseline required by the "Prove
// ProductClient Extraction Mechanics" contract (founder decision 7): a
// reproducible, deterministic measurement of the CURRENT legacy `apps/web`
// production bundle, split into
//   - the unauthenticated entry (what loads on the `/login` path before auth):
//     JS + CSS + fonts + images in the entry's STATIC import closure;
//   - per-route lazy chunks (chunks reached only via dynamic import); and
//   - the authenticated total (entry closure + every dynamically reachable
//     chunk, i.e. the whole product once authenticated).
//
// Compression metric: gzip via Node zlib at a fixed level (see GZIP_LEVEL),
// stated explicitly in the output so reruns are comparable. Sizes are exact
// byte counts; output is stable-sorted with no timestamps so two runs on the
// same source are byte-identical.
//
// IMPORTANT (decision 7): these numbers are a PROVISIONAL historical baseline,
// not a budget. The Legacy-Web-replacement PR reruns this collector on its own
// exact base immediately before deletion; those later numbers are the binding
// cutover baseline.
//
// Usage:
//   node scripts/collect-web-bundle-baseline.mjs [--out <path.json>] [--no-build]
//
// The collector builds `apps/web` production with `build.manifest` enabled via
// the PROLIFERATE_WEB_BUNDLE_MANIFEST=1 env flag (off in normal builds, so
// normal build output is unchanged), then walks dist/.vite/manifest.json.

import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const DIST_DIR = join(WEB_DIR, "dist");
const MANIFEST_PATH = join(DIST_DIR, ".vite", "manifest.json");

// zlib gzip level. Level 9 (maximum) is used for a stable, tool-independent
// number that does not vary with zlib's default-level heuristics.
const GZIP_LEVEL = 9;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let outPath = null;
let doBuild = true;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--out") {
    outPath = args[i + 1];
    i += 1;
  } else if (arg.startsWith("--out=")) {
    outPath = arg.slice("--out=".length);
  } else if (arg === "--no-build") {
    doBuild = false;
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
const FONT_EXT = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".ico",
]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg"]);

function classify(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".css") return "css";
  if (FONT_EXT.has(ext)) return "font";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (ext === ".map") return "sourcemap";
  return "other";
}

function gzipSize(file) {
  const bytes = readFileSync(join(DIST_DIR, file));
  return gzipSync(bytes, { level: GZIP_LEVEL }).length;
}

function rawSize(file) {
  return readFileSync(join(DIST_DIR, file)).length;
}

// ---------------------------------------------------------------------------
// Manifest graph
// ---------------------------------------------------------------------------
function loadManifest() {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

// Transitive set of manifest KEYS reachable following only `imports`
// (static import edges), starting from the given keys.
function staticClosure(manifest, startKeys) {
  const seen = new Set();
  const stack = [...startKeys];
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) continue;
    for (const dep of chunk.imports ?? []) stack.push(dep);
  }
  return seen;
}

// Every emitted FILE (js/css/asset) contributed by a set of manifest keys.
function collectFiles(manifest, keys) {
  const files = new Set();
  for (const key of keys) {
    const chunk = manifest[key];
    if (!chunk) continue;
    if (chunk.file) files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const asset of chunk.assets ?? []) files.add(asset);
  }
  return files;
}

// Sum the gzip + raw sizes of a file set, grouped by type. Deterministic:
// files listed in a stable sort.
function measure(files) {
  const perType = {};
  const filesList = [];
  for (const file of [...files].sort()) {
    const type = classify(file);
    const gzip = gzipSize(file);
    const raw = rawSize(file);
    perType[type] ??= { count: 0, gzipBytes: 0, rawBytes: 0 };
    perType[type].count += 1;
    perType[type].gzipBytes += gzip;
    perType[type].rawBytes += raw;
    filesList.push({ file, type, gzipBytes: gzip, rawBytes: raw });
  }
  const totalGzip = filesList.reduce((s, f) => s + f.gzipBytes, 0);
  const totalRaw = filesList.reduce((s, f) => s + f.rawBytes, 0);
  // Sort perType keys for stable output.
  const byType = {};
  for (const type of Object.keys(perType).sort()) byType[type] = perType[type];
  return {
    totalGzipBytes: totalGzip,
    totalRawBytes: totalRaw,
    byType,
    files: filesList,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
function buildWeb() {
  console.error("Building apps/web production (manifest enabled)...");
  const result = spawnSync(
    "pnpm",
    ["--filter", "@proliferate/web", "build"],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PROLIFERATE_WEB_BUNDLE_MANIFEST: "1" },
    },
  );
  if (result.status !== 0) {
    console.error(`web build failed (status ${result.status})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (doBuild) buildWeb();

  const manifest = loadManifest();

  const entryKeys = Object.keys(manifest)
    .filter((key) => manifest[key].isEntry)
    .sort();
  if (entryKeys.length === 0) {
    console.error("No entry chunk found in manifest.");
    process.exit(1);
  }

  // Unauthenticated entry = static import closure of every entry chunk. On
  // legacy Web this is the whole app, because App.tsx statically imports every
  // page (no route-level lazy split) — a fact this baseline records.
  const entryClosure = staticClosure(manifest, entryKeys);
  const unauthenticatedFiles = collectFiles(manifest, entryClosure);

  // Per-route lazy chunks = chunks reached via a dynamic import from anywhere
  // in the graph, excluding the static entry closure. Legacy Web has none.
  const allKeys = new Set(Object.keys(manifest));
  const dynamicKeys = new Set();
  for (const key of allKeys) {
    for (const dyn of manifest[key].dynamicImports ?? []) dynamicKeys.add(dyn);
  }
  // A dynamically-imported chunk drags its own static closure with it.
  const dynamicClosure = staticClosure(manifest, [...dynamicKeys]);
  const routeChunkKeys = [...dynamicClosure]
    .filter((key) => !entryClosure.has(key))
    .sort();

  const routeChunks = routeChunkKeys.map((key) => {
    const chunk = manifest[key];
    // Marginal cost of loading this route: the chunk plus its transitive
    // static imports, excluding what the entry already shipped.
    const marginalKeys = [...staticClosure(manifest, [key])]
      .filter((k) => !entryClosure.has(k))
      .sort();
    const files = collectFiles(manifest, marginalKeys);
    const m = measure(files);
    return {
      key,
      name: chunk.name ?? null,
      src: chunk.src ?? null,
      isDynamicEntry: chunk.isDynamicEntry === true,
      ...m,
    };
  });

  // Authenticated total = entry closure + every dynamically reachable chunk =
  // the full product a signed-in user eventually loads.
  const authenticatedKeys = new Set([...entryClosure, ...dynamicClosure]);
  const authenticatedFiles = collectFiles(manifest, authenticatedKeys);

  const report = {
    schema: "web-bundle-baseline/v1",
    provisional: true,
    note:
      "Provisional historical baseline of the CURRENT legacy apps/web bundle. "
      + "NOT a budget. The Legacy-Web-replacement PR reruns this collector on its "
      + "exact base immediately before deletion; those numbers are the binding "
      + "cutover baseline.",
    tool: "scripts/collect-web-bundle-baseline.mjs",
    command:
      "PROLIFERATE_WEB_BUNDLE_MANIFEST=1 pnpm --filter @proliferate/web build "
      + "(then walk apps/web/dist/.vite/manifest.json)",
    target: "apps/web",
    compressionMetric: `gzip (Node zlib, level ${GZIP_LEVEL})`,
    routeSplitting: routeChunks.length > 0 ? "present" : "none",
    entryChunks: entryKeys.map((key) => ({
      key,
      file: manifest[key].file,
      src: manifest[key].src ?? null,
    })),
    unauthenticatedEntry: measure(unauthenticatedFiles),
    routeChunks,
    authenticatedTotal: measure(authenticatedFiles),
  };

  const json = JSON.stringify(report, null, 2);
  process.stdout.write(json + "\n");

  if (outPath) {
    const resolved = outPath.startsWith("/")
      ? outPath
      : join(process.cwd(), outPath);
    writeFileSync(resolved, json + "\n");
    console.error(`\nWrote artifact: ${resolved}`);
  }

  // Human-readable summary to stderr (keeps stdout pure JSON).
  const fmt = (n) => `${(n / 1024).toFixed(1)} KiB`;
  console.error("\n=== Legacy Web bundle baseline (provisional) ===");
  console.error(`compression: ${report.compressionMetric}`);
  console.error(`route splitting: ${report.routeSplitting}`);
  console.error(
    `unauthenticated /login entry: ${fmt(report.unauthenticatedEntry.totalGzipBytes)} gzip `
    + `(${fmt(report.unauthenticatedEntry.totalRawBytes)} raw)`,
  );
  for (const [type, t] of Object.entries(report.unauthenticatedEntry.byType)) {
    console.error(`  - ${type}: ${t.count} file(s), ${fmt(t.gzipBytes)} gzip`);
  }
  console.error(`route chunks: ${report.routeChunks.length}`);
  console.error(
    `authenticated total: ${fmt(report.authenticatedTotal.totalGzipBytes)} gzip `
    + `(${fmt(report.authenticatedTotal.totalRawBytes)} raw)`,
  );
}

main();
