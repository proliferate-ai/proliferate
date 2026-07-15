#!/usr/bin/env node
// Minimal local updater feed for tier-4 desktop upgrade tests.
//
// Serves a staged directory of real Tauri updater artifacts plus a latest.json
// that matches the schema the release pipeline publishes
// (scripts/generate-updater-manifest.mjs): { version, pub_date, platforms:
// { "<target>": { signature, url } } }. A test-flavor app built with
// scripts/build-updater-test.sh (endpoint = this server's /latest.json) will
// discover the staged version through the real Tauri updater `check()`.
//
// Usage:
//   node tests/release/scripts/serve-updater-feed.mjs \
//     --dir <staged-artifacts-dir> --version <N> [--port 8787] [--host 127.0.0.1]
//
// The staged dir must contain the updater tarball (*.app.tar.gz) and its
// detached signature (*.app.tar.gz.sig) for each target being tested. Signatures
// are read verbatim from the .sig files (produced by `tauri build`/`tauri signer`).

import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { port: 8787, host: "127.0.0.1" };
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, "");
    o[k] = a[i + 1];
  }
  return o;
}

// Same darwin/{arch} target keys the production manifest generator emits.
const PLATFORMS = [
  { key: "darwin-aarch64", re: /(aarch64|arm64).*\.app\.tar\.gz$/i },
  { key: "darwin-x86_64", re: /(x64|x86_64).*\.app\.tar\.gz$/i },
];

function buildManifest(dir, version, baseUrl) {
  const files = readdirSync(dir);
  const platforms = {};
  for (const p of PLATFORMS) {
    const artifact = files.find((f) => p.re.test(f));
    if (!artifact) continue;
    const sig = files.find((f) => f === `${artifact}.sig`);
    if (!sig) throw new Error(`Missing signature ${artifact}.sig in ${dir}`);
    platforms[p.key] = {
      signature: readFileSync(join(dir, sig), "utf-8").trim(),
      url: `${baseUrl}/${encodeURIComponent(artifact)}`,
    };
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error(`No *.app.tar.gz artifacts found in ${dir}`);
  }
  return { version, pub_date: new Date().toISOString(), platforms };
}

function main() {
  const { dir, version, port, host } = parseArgs();
  if (!dir || !version) {
    console.error(
      "Usage: serve-updater-feed.mjs --dir <dir> --version <N> [--port 8787] [--host 127.0.0.1]",
    );
    process.exit(1);
  }
  if (!existsSync(dir)) {
    console.error(`Staged dir not found: ${dir}`);
    process.exit(1);
  }
  const baseUrl = `http://${host}:${port}`;
  const manifest = buildManifest(dir, version, baseUrl);

  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/latest.json" || path === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }
    const file = join(dir, basename(path));
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port, host, () => {
    console.log(`updater feed serving ${dir}`);
    console.log(`  manifest:  ${baseUrl}/latest.json  (version ${version})`);
    for (const [k, v] of Object.entries(manifest.platforms)) {
      console.log(`  ${k}: ${v.url}`);
    }
  });
}

main();
