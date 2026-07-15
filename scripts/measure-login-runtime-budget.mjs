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
// fresh cache, a fixed anonymous auth fixture, a durable ProductClient
// login-ready marker, `document.fonts.ready`, and a bounded network-idle settle
// that FAILS when it is not reached. This script is that gate, kept in-tree so
// it is reproducible and rerunnable against exact merged main.
//
// DETERMINISM (WDU-1247-B1 repair). The Web host boots by POSTing a real
// session bootstrap and probing the deployment for its sign-in methods. Left
// live those requests make the "readiness" ambiguous — a slow/erroring backend
// could render a retry screen that still contains a `button`/`input`, and an
// unsettled request stream could be silently ignored. This collector removes
// that ambiguity: it intercepts EVERY request, serves the built dist from the
// loopback origin, and answers the cross-origin API with a FIXED anonymous
// fixture (bootstrap 401 -> signed-out; deterministic method/health probes).
// Any request to an unexpected cross-origin endpoint fails the gate closed. It
// then waits for the durable `[data-auth-screen="auth"]` login-ready marker
// (set only once the shell resolves to the signed-out sign-in surface — an
// error/loading screen never satisfies it), and treats a network-idle that is
// never reached as a measurement failure rather than a pass.
//
// WHAT IT DOES.
//   1. Builds `apps/web` against the fixed fixture origin (skip with --no-build
//      to measure an existing dist).
//   2. Serves apps/web/dist over loopback.
//   3. Loads /login in headless Chromium with a fresh context (fresh cache) and
//      the fixed anonymous API fixture, records unique same-origin GET
//      responses until the durable login-ready marker + fonts + settled
//      network, then computes gzip-9 byte totals per kind
//      (js/css/font/image/audio) from the on-disk dist files (same compression
//      metric as the baseline collector).
//   4. Enforces the founder-approved gzip-9 ceilings FAIL-CLOSED (see CAPS):
//      exits non-zero if requested JS or CSS exceeds its cap, if any font /
//      image / audio byte is requested on /login (baseline is 0), or if an
//      unexpected cross-origin endpoint is requested.
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
//   (build first if using --no-build so the dist is built against the fixed
//    fixture origin: pnpm shared:build && VITE_PROLIFERATE_API_BASE_URL=<fixture>
//    pnpm web:build — the default rerun command below does this for you.)
//
// Exit codes: 0 = within all ceilings; 1 = over a ceiling / unexpected asset /
// unexpected cross-origin request; 2 = measurement could not be performed
// (build/serve/browser error, or the login-ready marker / network settle was
// never reached).

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

// Fixed anonymous auth fixture. The web build bakes in
// VITE_PROLIFERATE_API_BASE_URL, so we build against this sentinel origin and
// intercept it in the browser with canned signed-out responses. This makes the
// measurement hermetic and deterministic: no live backend, no
// slow/erroring-network ambiguity, and a login-ready state that is always the
// real signed-out sign-in surface.
const FIXTURE_API_ORIGIN = "https://login-budget-fixture.invalid";
// The durable ProductClient login-ready marker (AuthScreenLayout renders
// data-auth-screen="auth" only once resolved to the signed-out sign-in surface).
const LOGIN_READY_SELECTOR = '[data-auth-screen="auth"]';

const RERUN_COMMAND =
  `pnpm shared:build && VITE_PROLIFERATE_API_BASE_URL=${FIXTURE_API_ORIGIN} pnpm web:build ` +
  "&& node scripts/measure-login-runtime-budget.mjs --no-build";

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
  console.error(
    `[login-budget] building apps/web against fixture origin ${FIXTURE_API_ORIGIN}…`,
  );
  try {
    execFileSync("pnpm", ["run", "web:build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      // Bake the fixed fixture origin into the bundle so the login shell's
      // bootstrap/probe requests target an origin we deterministically stub.
      env: { ...process.env, VITE_PROLIFERATE_API_BASE_URL: FIXTURE_API_ORIGIN },
    });
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
// Cross-origin endpoints the fixed anonymous fixture answers. Anything else the
// login shell tries to reach cross-origin is an unexpected producer and fails
// the gate closed.
const unexpectedCrossOrigin = [];

// The fixed anonymous auth fixture: canned signed-out responses for exactly the
// endpoints the public login shell touches at boot (session bootstrap, health,
// sign-in method/availability probes). Bootstrap 401 -> the shell resolves to
// the signed-out sign-in surface; probes report a deterministic method set.
function fixtureResponseFor(pathname) {
  const json = (status, body) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  // Anonymous: no refresh cookie -> bootstrap/refresh are unauthorized.
  if (pathname === "/auth/web/session/bootstrap" || pathname === "/auth/web/session/refresh") {
    return json(401, { detail: "unauthenticated" });
  }
  if (pathname === "/health") return json(200, { status: "ok" });
  if (pathname === "/auth/desktop/methods") {
    return json(200, { password_login: false, github: true });
  }
  if (pathname === "/auth/desktop/github/availability") {
    return json(200, { enabled: true, client_id: "login-budget-fixture" });
  }
  if (pathname === "/auth/sso/discover") return json(200, { enabled: false });
  // The anonymous login shell also probes the connected deployment's public
  // capability contract and the launch catalog before auth. Answer both with
  // benign, deterministic bodies so the shell settles without a live backend.
  if (pathname === "/meta") return json(200, { capabilities: {} });
  if (pathname === "/v1/catalogs/agents") {
    return json(200, { schemaVersion: 2, agents: [] });
  }
  return null;
}

let browser;
let readyMarkerReached = false;
let networkSettled = false;
try {
  browser = await chromium.launch();
  const context = await browser.newContext(); // fresh profile = fresh cache
  const page = await context.newPage();

  // Intercept EVERY request. Loopback dist requests pass through to the local
  // server; the fixture origin gets canned anonymous answers; any other
  // cross-origin request is recorded as unexpected and aborted (fail-closed).
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) {
      route.continue();
      return;
    }
    if (u.origin === FIXTURE_API_ORIGIN) {
      const fixture = fixtureResponseFor(u.pathname);
      if (fixture) {
        route.fulfill(fixture);
        return;
      }
      // A fixture-origin path we did not anticipate: record and 404 it so the
      // shell resolves deterministically but the gate still flags the gap.
      unexpectedCrossOrigin.push(`${u.origin}${u.pathname}`);
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    // Truly unexpected cross-origin producer on the public login shell.
    unexpectedCrossOrigin.push(`${u.origin}${u.pathname}`);
    route.abort();
  });

  page.on("response", (resp) => {
    const u = new URL(resp.url());
    if (u.origin !== base) return;
    if (resp.request().method() !== "GET") return;
    const path = u.pathname;
    if (path === "/" || path === "/login" || path.endsWith(".html")) return; // document
    requested.set(path, kindOf(path));
  });

  await page.goto(`${base}/login`, { waitUntil: "load" });
  // Readiness: the durable ProductClient login-ready marker, i.e. the shell
  // resolved to the signed-out sign-in surface (not a loading/error screen).
  try {
    await page.waitForSelector(LOGIN_READY_SELECTOR, { timeout: 30_000 });
    readyMarkerReached = true;
  } catch {
    throw new Error(
      `login-ready marker ${LOGIN_READY_SELECTOR} never appeared; the signed-out ` +
        "sign-in surface was not reached (the ledger must not pass without it).",
    );
  }
  await page.evaluate(() => document.fonts.ready);
  // Bounded network-idle settle. A stream that never settles is a measurement
  // failure — we do NOT swallow the timeout and pass anyway.
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    networkSettled = true;
  } catch {
    throw new Error(
      "network never reached idle within 15s on /login; the request stream did " +
        "not settle, so the measurement is not trustworthy (fail closed).",
    );
  }
  // Short fixed drain for any late same-origin asset after idle.
  await page.waitForTimeout(2_000);
} catch (err) {
  await browser?.close().catch(() => {});
  server.close();
  fail(2, `runtime measurement failed: ${err?.message ?? err}`);
} finally {
  await browser?.close().catch(() => {});
  server.close();
}

if (!readyMarkerReached || !networkSettled) {
  fail(2, "readiness or network settle was not reached; refusing to emit a passing ledger.");
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
const unexpected = [...new Set(unexpectedCrossOrigin)].sort();
if (unexpected.length > 0) {
  violations.push(
    `unexpected cross-origin request(s) on /login: ${unexpected.join(", ")} ` +
      "(not in the fixed anonymous fixture)",
  );
}
const pass = violations.length === 0;

// ---- 5. ledger bound to tested SHA ----
const ledger = {
  schema: "login-runtime-budget/v1",
  measuredAt:
    "runtime headless chromium; fresh cache; fixed anonymous API fixture " +
    `(${FIXTURE_API_ORIGIN}); durable login-ready marker ${LOGIN_READY_SELECTOR}; ` +
    "document.fonts.ready; network-idle (fail-closed, not swallowed) + 2s drain",
  readiness: {
    loginReadySelector: LOGIN_READY_SELECTOR,
    markerReached: readyMarkerReached,
    networkSettled,
    fixtureApiOrigin: FIXTURE_API_ORIGIN,
    fixtureEndpoints: [
      "POST /auth/web/session/bootstrap -> 401 (anonymous)",
      "GET /health -> 200",
      "GET /auth/desktop/methods -> 200",
      "GET /auth/desktop/github/availability -> 200",
      "GET /auth/sso/discover -> 200 { enabled: false }",
    ],
  },
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
  unexpectedCrossOrigin: unexpected,
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
