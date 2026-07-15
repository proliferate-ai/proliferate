#!/usr/bin/env node
// Retained runtime /login budget collector + fail-closed gate (phase-6 cutover).
//
// WHY A RUNTIME COLLECTOR (not the static manifest walker). The binding legacy
// baseline was produced by `scripts/collect-web-bundle-baseline.mjs`, which
// walks the Vite manifest's STATIC import closure. For the replacement browser
// host that tool is not a faithful gate: the manifest still associates
// side-effect assets (e.g. `ding-*.mp3`) with `index.html`, so it would count
// bytes the browser never requests on `/login`. The phase-6 contract requires
// the gate to measure what the browser actually REQUESTS before readiness:
// fresh cache, a durable ProductClient readiness marker, `document.fonts.ready`,
// and a bounded network-idle settle. This script is that gate, kept in-tree so
// it is reproducible and rerunnable against exact merged main.
//
// WHAT IT DOES.
//   1. Builds `apps/web` (skip with --no-build to measure an existing dist).
//   2. Serves apps/web/dist over loopback.
//   3. Loads /login in headless Chromium with a fresh context (fresh cache),
//      records unique same-origin GET responses until readiness, then computes
//      gzip-9 byte totals per kind (js/css/font/image/audio) from the on-disk
//      dist files (same compression metric as the baseline collector).
//   4. Enforces the founder-approved gzip-9 ceilings FAIL-CLOSED (see CAPS):
//      exits non-zero if requested JS or CSS exceeds its cap, or if any font /
//      image / audio byte is requested on /login (baseline is 0).
//   5. Emits a machine-readable ledger bound to the tested commit SHA and
//      prints the exact rerun command.
//
// FOUNDER DECISION WDU-1247-D1 (approved 2026-07-15): exact gzip-9 /login
// ceilings — JS 485000 bytes, CSS 66000 bytes. This chose shared-shell
// simplicity / full shared-package Tailwind scanning over a separate
// auth-shell CSS build boundary. These caps are the enforceable gate; the
// legacy baseline (471,212 B JS / 24,226 B CSS) remains recorded context.
//
// USAGE.
//   node scripts/measure-login-runtime-budget.mjs [--no-build] [--out <path>]
//   (build first if using --no-build: pnpm shared:build && pnpm web:build)
//
// Exit codes: 0 = within all ceilings; 1 = over a ceiling / unexpected asset;
// 2 = measurement could not be performed (build/serve/browser error).

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(REPO_ROOT, "apps", "web", "dist");

// Founder-approved gzip-9 /login ceilings (WDU-1247-D1). Exact integer bytes.
const CAPS = { js: 485000, css: 66000 };
// Baseline requests zero of these on /login; any byte is a fail-closed
// regression (login/callback must not eagerly load fonts/images/audio).
const ZERO_KINDS = ["font", "image", "audio"];

const RERUN_COMMAND =
  "pnpm shared:build && pnpm web:build && node scripts/measure-login-runtime-budget.mjs --no-build";

const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

function fail(code, message) {
  console.error(`\n[login-budget] ${message}`);
  process.exit(code);
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".woff2": "font/woff2", ".woff": "font/woff",
  ".mp3": "audio/mpeg", ".ico": "image/x-icon",
};

function kindOf(p) {
  const e = extname(p);
  if (e === ".js") return "js";
  if (e === ".css") return "css";
  if (e === ".woff2" || e === ".woff" || e === ".ttf" || e === ".otf") return "font";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico"].includes(e)) return "image";
  if (e === ".mp3" || e === ".wav" || e === ".ogg") return "audio";
  return "other";
}

// Compression metric: gzip level 9 for text assets (js/css/svg/other); emitted
// (raw) bytes for already-compressed binary assets (fonts/images/audio) — same
// rule as the baseline collector.
function measuredBytes(kind, absFile) {
  const raw = readFileSync(absFile);
  const isText = kind === "js" || kind === "css" || kind === "other" || extname(absFile) === ".svg";
  return isText ? gzipSync(raw, { level: 9 }).length : raw.length;
}

function serveDist() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = normalize(url.pathname).replace(/^\/+/, "");
    let f = join(DIST, p);
    if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) {
      f = join(DIST, "index.html"); // SPA fallback
    }
    res.statusCode = 200;
    res.setHeader("content-type", MIME[extname(f)] ?? "application/octet-stream");
    // Force a fresh fetch every time; the browser context is also fresh.
    res.setHeader("cache-control", "no-store");
    createReadStream(f).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

// ---- 1. build ----
if (!noBuild) {
  console.error("[login-budget] building apps/web (pnpm web:build)…");
  try {
    execFileSync("pnpm", ["run", "web:build"], { cwd: REPO_ROOT, stdio: "inherit" });
  } catch {
    fail(2, "web:build failed; run `pnpm shared:build` first if package dist is stale.");
  }
}
if (!existsSync(join(DIST, "index.html"))) {
  fail(2, `no build at ${DIST}; run without --no-build, or build apps/web first.`);
}

// ---- 2. serve + 3. measure ----
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail(2, "playwright is not available; cannot run the runtime collector.");
}

const { server, port } = await serveDist();
const base = `http://127.0.0.1:${port}`;
const requested = new Map(); // pathname -> kind

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext(); // fresh profile = fresh cache
  const page = await context.newPage();

  page.on("response", (resp) => {
    const u = new URL(resp.url());
    if (u.origin !== base) return;
    if (resp.request().method() !== "GET") return;
    const path = u.pathname;
    if (path === "/" || path === "/login" || path.endsWith(".html")) return; // document
    requested.set(path, kindOf(path));
  });

  await page.goto(`${base}/login`, { waitUntil: "load" });
  // Readiness: the login shell rendered (ProductClient auth gate output present).
  await page.waitForSelector("button, input, [data-auth-screen], form", { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  // Bounded network-idle settle, then a fixed drain window for late requests.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
} catch (err) {
  await browser?.close().catch(() => {});
  server.close();
  fail(2, `runtime measurement failed: ${err?.message ?? err}`);
} finally {
  await browser?.close().catch(() => {});
  server.close();
}

// ---- tally ----
const perKind = {};
const files = [];
for (const [path, kind] of [...requested.entries()].sort()) {
  const abs = join(DIST, path.replace(/^\/+/, ""));
  if (!existsSync(abs)) continue;
  const bytes = measuredBytes(kind, abs);
  perKind[kind] = (perKind[kind] ?? 0) + bytes;
  files.push({ path, kind, bytes });
}
const total = Object.values(perKind).reduce((a, b) => a + b, 0);
const jsBytes = perKind.js ?? 0;
const cssBytes = perKind.css ?? 0;

// ---- 4. fail-closed gate ----
const violations = [];
if (jsBytes > CAPS.js) violations.push(`JS ${jsBytes} B > cap ${CAPS.js} B`);
if (cssBytes > CAPS.css) violations.push(`CSS ${cssBytes} B > cap ${CAPS.css} B`);
for (const k of ZERO_KINDS) {
  if ((perKind[k] ?? 0) > 0) {
    violations.push(`${k} ${perKind[k]} B requested on /login (baseline 0; must not eagerly load)`);
  }
}
const pass = violations.length === 0;

// ---- 5. ledger bound to tested SHA ----
const ledger = {
  schema: "login-runtime-budget/v1",
  measuredAt: "runtime headless chromium, fresh cache, ProductClient readiness marker, document.fonts.ready, bounded network-idle + 2s settle",
  testedSha: gitSha(),
  base: "/login",
  compressionMetric: "gzip (Node zlib, level 9) for js/css/svg/other; emitted bytes for fonts/images/audio",
  caps: { ...CAPS, source: "founder decision WDU-1247-D1 (2026-07-15), gzip-9 bytes" },
  legacyBaseline: {
    source: "specs/codebase/systems/product/clients/web-desktop-unification/migration/web-bundle-baseline-c6e094b41.json",
    jsGzipBytes: 471212,
    cssGzipBytes: 24226,
    note: "recorded context; the enforceable gate is the founder caps above",
  },
  perKind,
  total,
  jsBytes,
  cssBytes,
  headroom: { js: CAPS.js - jsBytes, css: CAPS.css - cssBytes },
  pass,
  violations,
  files,
  rerunCommand: RERUN_COMMAND,
};

const json = JSON.stringify(ledger, null, 2);
if (outPath) {
  const abs = join(REPO_ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, json + "\n");
  console.error(`[login-budget] ledger written to ${outPath}`);
}
console.log(json);

console.error(
  `\n[login-budget] JS ${jsBytes}/${CAPS.js} B  CSS ${cssBytes}/${CAPS.css} B  ` +
    `fonts/images/audio ${ZERO_KINDS.map((k) => `${k}=${perKind[k] ?? 0}`).join(" ")}`,
);
console.error(`[login-budget] rerun: ${RERUN_COMMAND}`);
if (!pass) {
  fail(1, `budget gate FAILED: ${violations.join("; ")}`);
}
console.error("[login-budget] budget gate PASSED (within all ceilings).");
