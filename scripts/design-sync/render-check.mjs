#!/usr/bin/env node
/**
 * QA render pass for the design-sync payload (scripts/design-sync/.out/).
 *
 * Serves the payload with serve.mjs, drives ONE headless Chromium instance
 * over every components/**\/*.html card, and produces:
 *   - .out/.render-check.json   one entry per card (errors, heuristics, texts)
 *   - .out/.review.html         iframe grid grouped by group, for eyeballing
 *   - .out/_screenshots/<group>__<Name>.png   per-card screenshot
 *   - .out/_screenshots/contact-sheet-N.png   ~16-per-sheet contact sheets
 *   - .out/_screenshots/.contact-sheet-N.html the html the sheet was shot from
 *   - .out/_screenshots/contact-sheets.json   sheet -> component names
 *
 * Browser acquisition (tries in order, first that works wins — see
 * acquireDriver() below):
 *   (a) playwright / playwright-core, Chrome channel via a local Google
 *       Chrome.app executablePath (no browser download)
 *   (b) puppeteer-core, same executablePath approach
 *   (c) raw Chrome DevTools Protocol over Node's built-in WebSocket/fetch,
 *       driving `Google Chrome --headless=new --remote-debugging-port=N`
 *       directly. No ws/CDP npm package needed — Node 22 ships a global
 *       WebSocket and fetch, which is all CDP needs (spike-tested standalone
 *       before wiring in: connect, Target.createTarget/attachToTarget,
 *       Page.navigate, Runtime.evaluate, Page.captureScreenshot all work).
 *   `pnpm dlx playwright@latest` / any install is FORBIDDEN and never
 *   attempted.
 *
 * Usage:
 *   node render-check.mjs [--dir <payloadDir>] [--limit N]
 *                          [--concurrency N] [--port N] [--strict]
 * Defaults: --dir scripts/design-sync/.out (relative to this file),
 * --concurrency 3, --port 0 (OS-assigned), --strict off (never a nonzero
 * exit; render-check is a QA artifact, not a pipeline gate).
 */
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { dirname, join, relative, basename, sep as PATH_SEP } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import { createServer } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SETTLE_MS = 400;
const CARD_TIMEOUT_MS = 25000;
const DEFAULT_WIDTH = 900;
const DEFAULT_MAX_HEIGHT = 1200;
const DEFAULT_MIN_HEIGHT = 80;
const PER_SHEET = 16;

// ---------------------------------------------------------------------------
// In-page check function. Passed by reference to playwright/puppeteer
// page.evaluate(), and stringified for the raw-CDP Runtime.evaluate path.
// Must be fully self-contained (no closures over outer scope).
// ---------------------------------------------------------------------------
function CHECK_FN() {
  function hasVisualContent(el) {
    if (!el) return false;
    var raw = el.innerText || el.textContent || "";
    var txt = raw.replace(/\s+/g, " ").trim();
    if (txt) return true;
    if (el.querySelector && el.querySelector("svg,img,canvas,video")) return true;
    var kids = el.querySelectorAll ? el.querySelectorAll("*") : [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].offsetWidth > 2 && kids[i].offsetHeight > 2) return true;
    }
    return false;
  }
  var cells = Array.prototype.slice.call(document.querySelectorAll(".ds-cell, .ds-single"));
  var bodyTextRaw = document.body ? document.body.innerText || document.body.textContent || "" : "";
  var bodyText = bodyTextRaw.replace(/\s+/g, " ").trim();
  var texts = cells.length
    ? cells.map(function (c) {
        return (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim();
      })
    : bodyText
    ? [bodyText]
    : [];
  var nCells = cells.length;
  var warnGlyph = String.fromCharCode(0x26a0);
  // texts already falls back to [bodyText] when there are no cells, so a
  // single pass over texts covers both the per-cell (mount() try/catch) and
  // whole-body (E.length===0 "no PascalCase exports") warning cases without
  // double-counting.
  var caught = 0;
  for (var i = 0; i < texts.length; i++) {
    if (texts[i].indexOf(warnGlyph) !== -1) caught++;
  }
  // rootEmpty is deliberately structural, not visual: "did the bootstrap
  // find at least one PascalCase preview export and mount it" (nCells>0).
  // A *visual* per-cell emptiness check breaks for portal-based overlays
  // (Dialog/Popover/DropdownMenu/CommandPalette render into a Radix portal
  // appended to <body>, leaving the .ds-single mount div itself empty and
  // aria-hidden even though the dialog is fully visible) — confirmed via
  // dry run against the reference AlertDialog card. `blank` (whole-body
  // visual check, below) already covers portaled content correctly.
  var rootEmpty = nCells === 0;
  var blank = !hasVisualContent(document.body);
  var maxHeight = Math.max(
    (document.documentElement && document.documentElement.scrollHeight) || 0,
    (document.body && document.body.scrollHeight) || 0,
    (document.documentElement && document.documentElement.offsetHeight) || 0
  );
  return { nCells: nCells, texts: texts, caught: caught, rootEmpty: rootEmpty, blank: blank, maxHeight: maxHeight };
}

function parseArgs(argv) {
  const opts = { dir: null, limit: null, concurrency: 3, port: 0, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--strict") opts.strict = true;
  }
  return opts;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, runner));
  return results;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Driver (a): playwright / playwright-core
// ---------------------------------------------------------------------------
async function tryPlaywright() {
  for (const modName of ["playwright", "playwright-core"]) {
    try {
      const mod = await import(modName);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (!chromium) continue;
      const launchOpts = existsSync(CHROME_PATH)
        ? { executablePath: CHROME_PATH, headless: true }
        : { channel: "chrome", headless: true };
      const browser = await chromium.launch(launchOpts);
      let context = await browser.newContext();
      return {
        engine: "playwright",
        lib: modName,
        async newPage() {
          const page = await context.newPage();
          const consoleErrors = [];
          const pageErrors = [];
          page.on("console", (msg) => {
            if (msg.type() === "error") consoleErrors.push(msg.text());
          });
          page.on("pageerror", (err) => pageErrors.push(err && err.message ? err.message : String(err)));
          return {
            async setViewport(w, h) {
              await page.setViewportSize({ width: w, height: Math.max(h, 50) });
            },
            async gotoAndSettle(url) {
              try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
              } catch (e) {
                pageErrors.push(`navigation: ${e.message}`);
              }
              try {
                await page.waitForLoadState("networkidle", { timeout: 4000 });
              } catch {
                /* best-effort only; demos with polling/animation never idle */
              }
              await page.waitForTimeout(SETTLE_MS);
            },
            async evalCheck() {
              return page.evaluate(CHECK_FN);
            },
            async screenshot(path, clip) {
              await page.screenshot({ path, clip: clip || undefined });
            },
            errors() {
              return { errs: consoleErrors.length + pageErrors.length, firstErr: pageErrors[0] || consoleErrors[0] || null };
            },
            async close() {
              await page.close().catch(() => {});
            },
          };
        },
        async closeAll() {
          await browser.close().catch(() => {});
        },
      };
    } catch {
      // try next
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driver (b): puppeteer-core
// ---------------------------------------------------------------------------
async function tryPuppeteer() {
  if (!existsSync(CHROME_PATH)) return null;
  try {
    const mod = await import("puppeteer-core");
    const puppeteer = mod.default || mod;
    const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
    return {
      engine: "puppeteer",
      lib: "puppeteer-core",
      async newPage() {
        const page = await browser.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        page.on("pageerror", (err) => pageErrors.push(String(err)));
        return {
          async setViewport(w, h) {
            await page.setViewport({ width: w, height: Math.max(h, 50) });
          },
          async gotoAndSettle(url) {
            try {
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
            } catch (e) {
              pageErrors.push(`navigation: ${e.message}`);
            }
            try {
              await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 });
            } catch {
              /* best-effort */
            }
            await new Promise((r) => setTimeout(r, SETTLE_MS));
          },
          async evalCheck() {
            return page.evaluate(CHECK_FN);
          },
          async screenshot(path, clip) {
            await page.screenshot({ path, clip: clip || undefined });
          },
          errors() {
            return { errs: consoleErrors.length + pageErrors.length, firstErr: pageErrors[0] || consoleErrors[0] || null };
          },
          async close() {
            await page.close().catch(() => {});
          },
        };
      },
      async closeAll() {
        await browser.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Driver (c): raw CDP over Node's built-in WebSocket + fetch. Last resort —
// only reached if neither playwright nor puppeteer-core resolve. Spike-
// tested standalone (Target.createTarget/attachToTarget, Page.navigate,
// Runtime.evaluate, Page.captureScreenshot with clip all confirmed working
// against a local Chrome.app before being folded in here).
// ---------------------------------------------------------------------------
async function tryCdp() {
  if (!existsSync(CHROME_PATH)) return null;
  const userDataDir = mkdtempSync(join(tmpdir(), "ds-render-check-cdp-"));
  const proc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        proc.stderr.off("data", onData);
        resolve(Number(m[1]));
      }
    };
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    setTimeout(() => reject(new Error("chrome did not print devtools port in time")), 10000);
  });

  const versionInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 0;
  const pending = new Map();
  const sessionListeners = new Map(); // sessionId -> { consoleErrors, pageErrors }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.sessionId && sessionListeners.has(msg.sessionId)) {
      const l = sessionListeners.get(msg.sessionId);
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
        l.consoleErrors.push(text || "console.error");
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        l.pageErrors.push((d && (d.exception?.description || d.text)) || "uncaught exception");
      }
    }
  };
  function send(method, params = {}, sessionId) {
    const id = ++msgId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  return {
    engine: "cdp",
    lib: "raw-cdp",
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      sessionListeners.set(sessionId, { consoleErrors: [], pageErrors: [] });
      await send("Page.enable", {}, sessionId);
      await send("Runtime.enable", {}, sessionId);
      let lastW = DEFAULT_WIDTH;
      let lastH = DEFAULT_MAX_HEIGHT;
      return {
        async setViewport(w, h) {
          lastW = w;
          lastH = Math.max(h, 50);
          await send("Emulation.setDeviceMetricsOverride", { width: w, height: lastH, deviceScaleFactor: 1, mobile: false }, sessionId);
        },
        async gotoAndSettle(url) {
          try {
            await withTimeout(send("Page.navigate", { url }, sessionId), 20000, "Page.navigate");
          } catch (e) {
            sessionListeners.get(sessionId).pageErrors.push(`navigation: ${e.message}`);
          }
          await new Promise((r) => setTimeout(r, 1200 + SETTLE_MS));
        },
        async evalCheck() {
          const res = await send(
            "Runtime.evaluate",
            { expression: `(${CHECK_FN.toString()})()`, returnByValue: true },
            sessionId
          );
          return res.result.value;
        },
        async screenshot(path, clip) {
          const shotClip = clip
            ? { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
            : { x: 0, y: 0, width: lastW, height: lastH, scale: 1 };
          const { data } = await send("Page.captureScreenshot", { format: "png", clip: shotClip }, sessionId);
          await writeFile(path, Buffer.from(data, "base64"));
        },
        errors() {
          const l = sessionListeners.get(sessionId);
          return { errs: l.consoleErrors.length + l.pageErrors.length, firstErr: l.pageErrors[0] || l.consoleErrors[0] || null };
        },
        async close() {
          sessionListeners.delete(sessionId);
          await send("Target.closeTarget", { targetId }).catch(() => {});
        },
      };
    },
    async closeAll() {
      try {
        ws.close();
      } catch {}
      proc.kill();
    },
  };
}

async function acquireDriver() {
  const a = await tryPlaywright();
  if (a) {
    console.log(`[render-check] browser driver: playwright (${a.lib}), Chrome at ${CHROME_PATH}`);
    return a;
  }
  const b = await tryPuppeteer();
  if (b) {
    console.log(`[render-check] browser driver: puppeteer-core, Chrome at ${CHROME_PATH}`);
    return b;
  }
  console.log("[render-check] playwright/puppeteer-core not resolvable — falling back to raw CDP");
  const c = await tryCdp();
  if (c) {
    console.log("[render-check] browser driver: raw CDP over Chrome --headless=new");
    return c;
  }
  throw new Error(
    "No renderer available: playwright/playwright-core/puppeteer-core did not resolve, and no local Chrome install " +
      `was found at ${CHROME_PATH} for the raw-CDP fallback.`
  );
}

// ---------------------------------------------------------------------------
// Card discovery + parsing
// ---------------------------------------------------------------------------
async function listCards(outDir) {
  const componentsDir = join(outDir, "components");
  if (!existsSync(componentsDir)) return [];
  const entries = await readdir(componentsDir, { recursive: true, withFileTypes: true });
  const rels = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".html")) continue;
    const dirAbs = e.parentPath ?? e.path;
    const abs = join(dirAbs, e.name);
    rels.push(relative(outDir, abs).split(PATH_SEP).join("/"));
  }
  return rels.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function parseDsCard(firstLine, fallbackGroup) {
  const m = /@dsCard\s+group="([^"]*)"(?:\s+viewport="(\d+)x(\d+)")?/.exec(firstLine || "");
  if (!m) return { group: fallbackGroup, viewport: null };
  return { group: m[1] || fallbackGroup, viewport: m[2] ? { w: Number(m[2]), h: Number(m[3]) } : null };
}

// ---------------------------------------------------------------------------
// Per-card processing
// ---------------------------------------------------------------------------
async function processCard(driver, baseUrl, outDir, screenshotsDir, cardRel) {
  const absHtmlPath = join(outDir, cardRel);
  const name = basename(cardRel, ".html");
  const fallbackGroup = cardRel.split("/")[1] || "unknown";

  let raw = "";
  try {
    raw = await readFile(absHtmlPath, "utf8");
  } catch (e) {
    return badEntry(name, fallbackGroup, cardRel, `harness: cannot read ${cardRel}: ${e.message}`);
  }
  const firstLine = raw.split("\n", 1)[0];
  const { group, viewport } = parseDsCard(firstLine, fallbackGroup);
  const url = `${baseUrl}/${cardRel.split("/").map(encodeURIComponent).join("/")}`;

  let page;
  try {
    page = await driver.newPage();
  } catch (e) {
    return badEntry(name, group, cardRel, `harness: newPage failed: ${e.message}`);
  }

  try {
    return await withTimeout(
      (async () => {
        if (viewport) {
          await page.setViewport(viewport.w, viewport.h);
        } else {
          await page.setViewport(DEFAULT_WIDTH, DEFAULT_MAX_HEIGHT);
        }
        await page.gotoAndSettle(url);
        const check = await page.evalCheck();
        const { errs, firstErr } = page.errors();

        let clip = null;
        if (!viewport) {
          const shotHeight = Math.min(Math.max(Math.ceil(check.maxHeight || 0), DEFAULT_MIN_HEIGHT), DEFAULT_MAX_HEIGHT);
          clip = { x: 0, y: 0, width: DEFAULT_WIDTH, height: shotHeight };
        }
        const pngName = `${group}__${name}.png`;
        const pngPath = join(screenshotsDir, pngName);
        let pngBytes = 0;
        try {
          await page.screenshot(pngPath, clip);
          pngBytes = (await stat(pngPath)).size;
        } catch (e) {
          if (!firstErr) {
            // keep original render firstErr priority; only note screenshot failure if nothing else was captured
          }
        }

        const bad = errs > 0 || check.rootEmpty || check.blank || check.caught > 0;
        return {
          name,
          group,
          rel: cardRel,
          errs,
          caught: check.caught,
          firstErr: firstErr || null,
          pngBytes,
          blank: check.blank,
          rootEmpty: check.rootEmpty,
          nCells: check.nCells,
          maxHeight: Math.round(check.maxHeight || 0),
          bad,
          texts: (check.texts || []).slice(0, 8).map((t) => (t.length > 500 ? t.slice(0, 500) + "…" : t)),
        };
      })(),
      CARD_TIMEOUT_MS,
      `card ${cardRel}`
    );
  } catch (e) {
    return badEntry(name, group, cardRel, `harness: ${e && e.message ? e.message : String(e)}`);
  } finally {
    await page.close().catch(() => {});
  }
}

function badEntry(name, group, rel, firstErr) {
  return {
    name,
    group,
    rel,
    errs: 1,
    caught: 0,
    firstErr,
    pngBytes: 0,
    blank: true,
    rootEmpty: true,
    nCells: 0,
    maxHeight: 0,
    bad: true,
    texts: [],
  };
}

// ---------------------------------------------------------------------------
// .review.html
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildReviewHtml(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  const groupNames = [...groups.keys()].sort();
  let body = "";
  for (const g of groupNames) {
    const items = groups.get(g).slice().sort((a, b) => a.name.localeCompare(b.name));
    body += `<h2 style="font:600 16px system-ui;margin:28px 0 10px;color:#374151">${esc(g)}</h2>\n`;
    body += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:16px">`;
    for (const it of items) {
      const mark = it.bad ? `<span style="font-weight:400;color:#dc2626">✗</span>` : `<span style="font-weight:400;color:#16a34a">✓</span>`;
      body += `<figure style="margin:0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden"><figcaption style="font:600 13px system-ui;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb">${esc(
        it.name
      )} ${mark}</figcaption><iframe src="${esc(it.rel)}" loading="lazy" style="width:100%;height:340px;border:0" title="${esc(
        it.name
      )}"></iframe></figure>\n`;
    }
    body += `</div>\n`;
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Design-system preview review</title></head>
<body style="margin:0;padding:24px;background:#fff;font-family:system-ui">
<h1 style="font:600 20px system-ui;margin:0 0 4px">Preview review — ${entries.length} components</h1>
<p style="font:13px system-ui;color:#6b7280;margin:0">Each card below is the live preview html exactly as the app will render it. Tell the agent which ones look wrong.</p>
${body}</body></html>`;
}

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------
function buildSheetHtml(sheetNum, totalSheets, startIdx, chunk, total) {
  const cols = 4;
  let cells = "";
  for (const it of chunk) {
    const mark = it.bad ? `<span style="font-weight:400;color:#dc2626">✗</span>` : `<span style="font-weight:400;color:#555">✓</span>`;
    const err = it.bad && it.firstErr ? `<div style="font:11px system-ui;color:#b91c1c;padding:0 8px 6px;overflow-wrap:anywhere">${esc(
      String(it.firstErr).slice(0, 140)
    )}</div>` : "";
    cells += `<div style="border:2px solid #ddd;background:#fff;min-width:0"><div style="font:600 18px system-ui;color:#222;padding:6px 8px;overflow-wrap:anywhere">${esc(
      it.name
    )} ${mark}</div>${err}<img src="./${esc(it.group)}__${esc(it.name)}.png" style="width:330px;height:300px;object-fit:cover;object-position:top left;display:block"></div>\n`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff;width:1500px"><div style="font:600 20px system-ui;color:#222;padding:12px 10px">render check — sheet ${sheetNum}/${totalSheets} — components ${
    startIdx + 1
  }–${startIdx + chunk.length} of ${total} (alphabetical)</div><div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:10px;padding:0 10px 10px">${cells}</div></body></html>`;
}

async function buildContactSheets(driver, baseUrl, screenshotsDir, entries) {
  const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
  const total = sorted.length;
  const totalSheets = Math.max(1, Math.ceil(total / PER_SHEET));
  const sheetsMeta = [];
  for (let s = 0; s < totalSheets; s++) {
    const startIdx = s * PER_SHEET;
    const chunk = sorted.slice(startIdx, startIdx + PER_SHEET);
    if (chunk.length === 0) break;
    const sheetNum = s + 1;
    const html = buildSheetHtml(sheetNum, totalSheets, startIdx, chunk, total);
    const htmlPath = join(screenshotsDir, `.contact-sheet-${sheetNum}.html`);
    await writeFile(htmlPath, html, "utf8");
    sheetsMeta.push({ sheet: sheetNum, components: chunk.map((c) => c.name) });

    const rows = Math.ceil(chunk.length / 4);
    const height = 60 + rows * 316;
    const page = await driver.newPage();
    try {
      await page.setViewport(1500, height);
      await page.gotoAndSettle(`${baseUrl}/_screenshots/.contact-sheet-${sheetNum}.html`);
      await page.screenshot(join(screenshotsDir, `contact-sheet-${sheetNum}.png`), { x: 0, y: 0, width: 1500, height });
    } finally {
      await page.close().catch(() => {});
    }
  }
  await writeFile(join(screenshotsDir, "contact-sheets.json"), JSON.stringify(sheetsMeta, null, 2), "utf8");
  return sheetsMeta;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = opts.dir ? (opts.dir.startsWith("/") ? opts.dir : join(process.cwd(), opts.dir)) : join(here, ".out");

  if (!existsSync(outDir)) {
    console.error(`[render-check] payload dir does not exist: ${outDir}`);
    process.exit(opts.strict ? 1 : 0);
    return;
  }

  let cards = await listCards(outDir);
  if (opts.limit) cards = cards.slice(0, opts.limit);
  if (cards.length === 0) {
    console.error(`[render-check] no components/**/*.html cards found under ${outDir}`);
    process.exit(opts.strict ? 1 : 0);
    return;
  }
  console.log(`[render-check] found ${cards.length} card(s) under ${outDir}/components`);

  const screenshotsDir = join(outDir, "_screenshots");
  await mkdir(screenshotsDir, { recursive: true });

  const { url: baseUrl, close: closeServer } = await createServer(outDir, { port: opts.port });
  console.log(`[render-check] serving payload at ${baseUrl}`);

  const driver = await acquireDriver();

  let entries;
  try {
    entries = await pool(cards, opts.concurrency, (rel) => processCard(driver, baseUrl, outDir, screenshotsDir, rel));
  } finally {
    // driver stays alive for contact sheets; closed after
  }

  await writeFile(join(outDir, ".render-check.json"), JSON.stringify(entries, null, 2), "utf8");
  await writeFile(join(outDir, ".review.html"), buildReviewHtml(entries), "utf8");

  const sheetsMeta = await buildContactSheets(driver, baseUrl, screenshotsDir, entries);

  await driver.closeAll();
  await closeServer();

  const bad = entries.filter((e) => e.bad);
  const clean = entries.length - bad.length;
  console.log("");
  console.log(`[render-check] ${entries.length} card(s) checked, ${clean} clean, ${bad.length} flagged`);
  console.log(`[render-check] contact sheets: ${sheetsMeta.length} (${join(screenshotsDir, "contact-sheet-1.png")} ...)`);
  if (bad.length > 0) {
    console.log("\n[render-check] flagged cards:");
    for (const e of bad) {
      const flags = [];
      if (e.errs > 0) flags.push(`errs=${e.errs}`);
      if (e.rootEmpty) flags.push("rootEmpty");
      if (e.blank) flags.push("blank");
      if (e.caught > 0) flags.push(`caught=${e.caught}`);
      console.log(`  - ${e.group}/${e.name}  [${flags.join(", ")}]  ${e.firstErr ? `firstErr: ${e.firstErr}` : ""}`);
    }
  }

  if (opts.strict && bad.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[render-check] fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});
