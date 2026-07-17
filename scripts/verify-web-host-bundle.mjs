#!/usr/bin/env node
// Verifies the hosted Web app (apps/web) production build emits and serves the
// shared ProductClient bundle from a thin browser host: the ProductClient
// entry JS, the shared product CSS, representative font/image assets, and the
// lazily code-split AuthenticatedProductClient chunk — and proves the public
// entry does NOT eagerly (statically) include that authenticated chunk.
//
// This is the WDU slice-05 counterpart of
// scripts/verify-product-client-qualification.mjs (which proves the same shape
// for the throwaway qualification fixtures). Here the subject is the real
// `apps/web` host, so the durable proof travels with the shipped app.
//
// It:
//   1. Production-builds apps/web with the Vite manifest enabled
//      (PROLIFERATE_WEB_BUNDLE_MANIFEST=1). Set SKIP_BUILD=1 to reuse an
//      existing dist for fast local iteration.
//   2. Inspects apps/web/dist/.vite/manifest.json and asserts the lazy
//      authenticated split: the public entry's static-import closure excludes
//      the AuthenticatedProductClient chunk, and that chunk is emitted as a
//      dynamic entry reachable only through a dynamic import.
//   3. Serves apps/web/dist over HTTP on an ephemeral port, fetches index.html
//      plus every emitted manifest URL, and asserts each returns HTTP 200.
//   4. Cross-checks that the representative resource shapes were emitted (the
//      shared ProductClient JS, the shared product CSS with real product-css
//      content, a font, and an image) and that the lazy chunk was served.
//
// Exits nonzero on any failure. This is the checked-in proof that the Web host
// build serves ProductClient's representative resource + code-split shapes.

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_DIST = "apps/web/dist";

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`  FAIL: ${message}`);
}
function ok(message) {
  console.log(`  ok: ${message}`);
}

function run(command, args, cwd, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(command, args, {
    cwd: join(REPO_ROOT, cwd),
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Production-build apps/web with the Vite manifest enabled.
// ---------------------------------------------------------------------------
function buildWebHost() {
  if (process.env.SKIP_BUILD === "1") {
    console.log("SKIP_BUILD=1 — reusing existing apps/web/dist");
    return;
  }
  // `@proliferate/web`'s build script chain-builds product-client (and its own
  // shared prerequisites), tsc-checks, then runs `vite build`. The manifest env
  // flag adds only dist/.vite/manifest.json; it changes no app code or chunking.
  run("pnpm", ["--filter", "@proliferate/web", "build"], ".", {
    PROLIFERATE_WEB_BUNDLE_MANIFEST: "1",
  });
}

// ---------------------------------------------------------------------------
// 2. Manifest inspection: prove the lazy authenticated split.
// ---------------------------------------------------------------------------
const AUTH_CANARY_NEEDLE = "AuthenticatedProductClient";
const PRODUCT_CLIENT_ORIGIN = "packages/product-client/";
// A representative token that ships only via @proliferate/design/product.css;
// its presence in the bundled stylesheet proves the shared product CSS entry
// was compiled in, not an empty local stylesheet.
const PRODUCT_CSS_MARKER = "--radius-composer";

async function loadManifest(distDir) {
  const manifestPath = join(REPO_ROOT, distDir, ".vite", "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  return { manifest: JSON.parse(raw), manifestPath };
}

// Collect the transitive STATIC import closure of a manifest chunk, following
// only `imports` (never `dynamicImports`).
function staticClosure(manifest, startKey) {
  const seen = new Set();
  const stack = [startKey];
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) continue;
    for (const dep of chunk.imports ?? []) {
      stack.push(dep);
    }
  }
  return seen;
}

function assertLazySplit(label, manifest) {
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entryKey) {
    fail(`${label}: no entry chunk found in manifest`);
    return;
  }

  // The shared ProductClient JS must be bundled into the served graph.
  const productClientChunks = Object.keys(manifest).filter((key) =>
    key.includes(PRODUCT_CLIENT_ORIGIN),
  );
  if (productClientChunks.length === 0) {
    fail(`${label}: no @proliferate/product-client chunk present in the manifest`);
  } else {
    ok(`${label}: shared ProductClient JS present (${productClientChunks.length} chunk(s))`);
  }

  // The authenticated canary chunk(s): any chunk whose key/file/name references
  // the authenticated canary module by name.
  const authenticatedChunkKeys = Object.keys(manifest).filter(
    (key) =>
      key.includes(AUTH_CANARY_NEEDLE) ||
      (manifest[key].file ?? "").includes(AUTH_CANARY_NEEDLE) ||
      (manifest[key].name ?? "").includes(AUTH_CANARY_NEEDLE),
  );
  if (authenticatedChunkKeys.length === 0) {
    fail(`${label}: authenticated canary chunk not found in manifest (split not emitted)`);
    return;
  }

  // It must be emitted as a dynamic entry (its own on-demand chunk).
  for (const key of authenticatedChunkKeys) {
    if (manifest[key].isDynamicEntry !== true) {
      fail(`${label}: authenticated canary chunk ${key} is not a dynamic entry`);
    }
  }

  // The public entry's STATIC closure must not contain the authenticated chunk.
  const closure = staticClosure(manifest, entryKey);
  const leaked = authenticatedChunkKeys.filter((key) => closure.has(key));
  if (leaked.length > 0) {
    fail(
      `${label}: public entry statically includes the authenticated canary chunk(s): ${leaked.join(", ")}`,
    );
    return;
  }

  // And it must be reachable as a dynamic import somewhere in the graph.
  const anyDynamic = Object.values(manifest).some((chunk) =>
    (chunk.dynamicImports ?? []).some((dep) => authenticatedChunkKeys.includes(dep)),
  );
  if (!anyDynamic) {
    fail(`${label}: authenticated canary chunk is never referenced as a dynamic import`);
    return;
  }

  ok(`${label}: lazy authenticated split verified (entry=${entryKey})`);
}

// ---------------------------------------------------------------------------
// 3. Serve the dist and assert every emitted URL returns 200.
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function serveDir(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = join(rootDir, rel);
      // Contain within rootDir.
      if (!filePath.startsWith(rootDir)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", MIME[extname(filePath)] ?? "application/octet-stream");
      createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error("serve error:", error);
      res.statusCode = 500;
      res.end("internal error");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function assertServedAssets(label, distDir, manifest) {
  const rootDir = join(REPO_ROOT, distDir);
  const { server, port } = await serveDir(rootDir);
  const base = `http://127.0.0.1:${port}`;

  // The full URL set: index.html + every emitted `file`, plus every emitted css
  // and asset listed on each chunk.
  const urls = new Set(["/index.html"]);
  for (const chunk of Object.values(manifest)) {
    if (chunk.file) urls.add(`/${chunk.file}`);
    for (const css of chunk.css ?? []) urls.add(`/${css}`);
    for (const asset of chunk.assets ?? []) urls.add(`/${asset}`);
  }

  try {
    let checked = 0;
    for (const url of urls) {
      const response = await fetch(`${base}${url}`);
      if (response.status !== 200) {
        fail(`served asset ${url} returned HTTP ${response.status}`);
      } else {
        checked += 1;
      }
    }
    if (checked === urls.size) {
      ok(`${label} host served ${checked} asset URL(s), all HTTP 200`);
    }

    const emittedFiles = [...urls];
    const requireShape = (predicate, description) => {
      if (!emittedFiles.some(predicate)) {
        fail(`${label} host did not emit a ${description} asset`);
      } else {
        ok(`${label} host emitted a ${description} asset`);
      }
    };
    // The shapes the shared product bundle must ship from the Web host. (No
    // .svg is asserted: the current product assets emit fonts/png/jpeg/mp3 but
    // no standalone svg — asserting one would test the fixture, not the host.)
    requireShape((u) => u.endsWith(".js"), "JS (ProductClient)");
    requireShape((u) => u.endsWith(".css"), "CSS (product.css)");
    requireShape((u) => u.endsWith(".woff2") || u.endsWith(".woff"), "font");
    requireShape((u) => u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg"), "image");

    // The lazy authenticated chunk must itself be a served 200.
    const authUrl = emittedFiles.find((u) => u.includes(AUTH_CANARY_NEEDLE));
    if (authUrl) {
      ok(`${label} host served the lazy authenticated chunk (${authUrl})`);
    } else {
      fail(`${label} host did not serve a lazy authenticated chunk`);
    }

    // Prove the served CSS carries real shared product-css content.
    const cssUrl = emittedFiles.find((u) => u.endsWith(".css"));
    if (cssUrl) {
      const cssBody = await (await fetch(`${base}${cssUrl}`)).text();
      if (cssBody.includes(PRODUCT_CSS_MARKER)) {
        ok(`${label} host CSS contains shared product token (${PRODUCT_CSS_MARKER})`);
      } else {
        fail(`${label} host CSS is missing the shared product token (${PRODUCT_CSS_MARKER})`);
      }
    }
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  buildWebHost();

  console.log("\n== Manifest inspection ==");
  const { manifest } = await loadManifest(WEB_DIST);
  assertLazySplit("web", manifest);

  console.log("\n== Web host served-asset check ==");
  await assertServedAssets("web", WEB_DIST, manifest);

  console.log("");
  if (failures.length > 0) {
    console.error(`FAILED with ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log("Web host ProductClient bundle proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
