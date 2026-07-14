#!/usr/bin/env node
// Verifies the ProductClient extraction build canary from both hosts.
//
// It:
//   1. Builds the shared package prerequisites and both qualification outputs
//      (Desktop build canary + minimal browser host), production Vite builds
//      with `manifest: true`.
//   2. Inspects each Vite manifest and asserts the required lazy code-split:
//      the public shell entry must NOT eagerly (statically) include the
//      authenticated canary chunk; that chunk must be reached only via a
//      dynamic import.
//   3. Serves the browser-host dist over HTTP on an ephemeral port, then fetches
//      index.html plus every emitted asset URL from the manifest and asserts
//      each returns HTTP 200.
//
// Exits nonzero on any failure. This is the checked-in proof that the host
// builds emit ProductClient's representative resource + code-split shapes.

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`  FAIL: ${message}`);
}
function ok(message) {
  console.log(`  ok: ${message}`);
}

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(command, args, {
    cwd: join(REPO_ROOT, cwd),
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Build prerequisites + both qualification outputs.
// ---------------------------------------------------------------------------
function buildEverything() {
  // product-client build chains cloud-sdk + anyharness sdk/sdk-react +
  // product-domain, then tsc, then copies the canary assets into dist.
  run("pnpm", ["--filter", "@proliferate/product-client", "build"], ".");
  // Host builds additionally consume shared product CSS and the Cloud SDK React
  // provider, so those dists must exist too.
  run("pnpm", ["--filter", "@proliferate/design", "build"], ".");
  run("pnpm", ["--filter", "@proliferate/cloud-sdk-react", "build"], ".");

  // Desktop build canary (dedicated qualification config; does not touch the
  // normal desktop build).
  run("pnpm", ["exec", "vite", "build", "--config", "vite.qualification.config.ts"], "apps/desktop");
  // Minimal browser host (production build). The browser-host directory is not
  // itself a workspace package, so the build is driven through the product-client
  // package (where vite is declared); the config sets an absolute root/outDir.
  run(
    "pnpm",
    [
      "--filter",
      "@proliferate/product-client",
      "exec",
      "vite",
      "build",
      "--config",
      "qualification/browser-host/vite.config.ts",
    ],
    ".",
  );
}

// ---------------------------------------------------------------------------
// 2. Manifest inspection: prove the lazy authenticated split.
// ---------------------------------------------------------------------------
const AUTH_CANARY_NEEDLE = "AuthenticatedProductClientBuildCanary";

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

  // The authenticated canary chunk(s): any chunk whose emitted file references
  // the authenticated canary module by name.
  const authKeys = Object.keys(manifest).filter(
    (key) =>
      key.includes(AUTH_CANARY_NEEDLE) ||
      (manifest[key].file ?? "").includes(AUTH_CANARY_NEEDLE) ||
      (manifest[key].name ?? "").includes(AUTH_CANARY_NEEDLE),
  );
  if (authKeys.length === 0) {
    fail(`${label}: authenticated canary chunk not found in manifest (split not emitted)`);
    return;
  }

  // It must be emitted as a dynamic entry (its own on-demand chunk), never
  // folded into a static chunk.
  for (const key of authKeys) {
    if (manifest[key].isDynamicEntry !== true) {
      fail(`${label}: authenticated canary chunk ${key} is not a dynamic entry`);
    }
  }

  // The entry's STATIC closure must not contain the authenticated canary chunk.
  const closure = staticClosure(manifest, entryKey);
  const leaked = authKeys.filter((key) => closure.has(key));
  if (leaked.length > 0) {
    fail(
      `${label}: public shell entry statically includes the authenticated canary chunk(s): ${leaked.join(", ")}`,
    );
    return;
  }

  // And it must be reachable as a dynamic import somewhere in the graph.
  const anyDynamic = Object.values(manifest).some((chunk) =>
    (chunk.dynamicImports ?? []).some((dep) => authKeys.includes(dep)),
  );
  if (!anyDynamic) {
    fail(`${label}: authenticated canary chunk is never referenced as a dynamic import`);
    return;
  }

  ok(`${label}: lazy authenticated split verified (entry=${entryKey})`);
}

// ---------------------------------------------------------------------------
// 3. Serve the browser-host dist and assert every emitted URL returns 200.
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
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function assertServedAssets(browserDistDir, manifest) {
  const rootDir = join(REPO_ROOT, browserDistDir);
  const { server, port } = await serveDir(rootDir);
  const base = `http://127.0.0.1:${port}`;

  // The full URL set: index.html + every emitted `file`, plus every emitted
  // css asset listed on each chunk.
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
      ok(`browser host served ${checked} asset URL(s), all HTTP 200`);
    }

    // Cross-check: at least one font, one image, one audio, and the shared CSS
    // are present among emitted assets — proving the resource canary actually
    // emitted its representative shapes.
    const emittedFiles = [...urls];
    const requireShape = (predicate, description) => {
      if (!emittedFiles.some(predicate)) {
        fail(`browser host did not emit a ${description} asset`);
      } else {
        ok(`browser host emitted a ${description} asset`);
      }
    };
    requireShape((u) => u.endsWith(".css"), "CSS");
    requireShape((u) => u.endsWith(".woff2") || u.endsWith(".woff"), "font");
    requireShape((u) => u.endsWith(".png"), "image (png)");
    requireShape((u) => u.endsWith(".mp3"), "audio (mp3)");
    requireShape((u) => u.endsWith(".svg"), "svg (asset url)");
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  buildEverything();

  console.log("\n== Manifest inspection ==");
  const desktopDist = "apps/desktop/dist-product-client-qualification";
  const browserDist = "apps/packages/product-client/qualification/browser-host/dist";

  const { manifest: desktopManifest } = await loadManifest(desktopDist);
  assertLazySplit("desktop", desktopManifest);

  const { manifest: browserManifest } = await loadManifest(browserDist);
  assertLazySplit("browser", browserManifest);

  console.log("\n== Browser host served-asset check ==");
  await assertServedAssets(browserDist, browserManifest);

  console.log("");
  if (failures.length > 0) {
    console.error(`FAILED with ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log("ProductClient qualification build proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
