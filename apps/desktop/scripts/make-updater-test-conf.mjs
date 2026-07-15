#!/usr/bin/env node
// Materialize the TEST-ONLY updater overlay from its checked-in template.
//
// Reads the template at src-tauri/updater-test.conf.json.template, substitutes
// the endpoint + pubkey placeholders, and writes src-tauri/updater-test.conf.json
// (gitignored). That output is handed to `tauri build --config` as an overlay so
// a test build points the auto-updater at a local manifest server signed by a
// throwaway key. The shipped tauri.conf.json is never touched.
//
// Usage:
//   UPDATER_URL=http://127.0.0.1:8787/latest.json \
//   UPDATER_PUBKEY=<base64 minisign pubkey> \
//   node scripts/make-updater-test-conf.mjs [--out <path>] [--template <path>]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = resolve(HERE, "..", "src-tauri");
const ENDPOINT_TOKEN = "__UPDATER_ENDPOINT__";
const PUBKEY_TOKEN = "__UPDATER_PUBKEY__";

// Every key the overlay is permitted to set. Anything else would be deep-merged
// into the shipped config by `tauri build --config`, so the template is asserted
// against this allowlist -- that guard is the whole safety story.
const ALLOWED_UPDATER_KEYS = [
  "endpoints",
  "pubkey",
  // Required for an http (localhost) feed; release builds reject non-https
  // endpoints without it. Test-only; never in the shipped config.
  "dangerousInsecureTransportProtocol",
];

// Pure, unit-testable core: given the template text + inputs, return the overlay
// object. Substitutes the endpoint/pubkey placeholders and enforces that the
// template only touches allowed plugins.updater keys.
export function renderOverlay(templateText, { url, pubkey }) {
  if (!url) throw new Error("UPDATER_URL is required");
  if (!pubkey) throw new Error("UPDATER_PUBKEY is required");

  const substituted = stripComment(templateText)
    .replaceAll(ENDPOINT_TOKEN, escapeJson(url))
    .replaceAll(PUBKEY_TOKEN, escapeJson(pubkey));
  const overlay = JSON.parse(substituted);
  assertOnlyUpdaterKeys(overlay);
  return overlay;
}

function stripComment(text) {
  const obj = JSON.parse(text);
  delete obj.$comment;
  return JSON.stringify(obj);
}

function escapeJson(s) {
  // JSON.stringify a string yields a quoted, escaped literal; drop the quotes
  // so it slots into the template's existing quotes.
  return JSON.stringify(s).slice(1, -1);
}

export function assertOnlyUpdaterKeys(overlay) {
  const copy = { ...overlay };
  delete copy.$comment;
  const topKeys = Object.keys(copy);
  if (topKeys.length !== 1 || topKeys[0] !== "plugins") {
    throw new Error(
      `Overlay must only contain "plugins" (plus $comment); found: ${topKeys.join(", ")}`,
    );
  }
  const pluginKeys = Object.keys(copy.plugins);
  if (pluginKeys.length !== 1 || pluginKeys[0] !== "updater") {
    throw new Error(
      `Overlay plugins must only contain "updater"; found: ${pluginKeys.join(", ")}`,
    );
  }
  for (const k of Object.keys(copy.plugins.updater)) {
    if (!ALLOWED_UPDATER_KEYS.includes(k)) {
      throw new Error(
        `Overlay updater sets disallowed key "${k}"; allowed: ${ALLOWED_UPDATER_KEYS.join(", ")}`,
      );
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  let out = resolve(SRC_TAURI, "updater-test.conf.json");
  let templatePath = resolve(SRC_TAURI, "updater-test.conf.json.template");
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--out") out = resolve(args[i + 1]);
    else if (args[i] === "--template") templatePath = resolve(args[i + 1]);
  }

  const templateText = readFileSync(templatePath, "utf-8");
  const overlay = renderOverlay(templateText, {
    url: process.env.UPDATER_URL,
    pubkey: process.env.UPDATER_PUBKEY,
  });
  writeFileSync(out, JSON.stringify(overlay, null, 2) + "\n");
  console.log(`Wrote test updater overlay to ${out}`);
  console.log(`  endpoint: ${overlay.plugins.updater.endpoints[0]}`);
  console.log(`  pubkey:   ${overlay.plugins.updater.pubkey.slice(0, 24)}...`);
}

// Run only when invoked directly, not when imported by the test suite.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
