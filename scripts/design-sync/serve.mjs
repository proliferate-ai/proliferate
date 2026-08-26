#!/usr/bin/env node
/**
 * Tiny static file server for a design-sync payload directory. No deps
 * (node:http only). Used by render-check.mjs to serve scripts/design-sync/.out/
 * over http:// so card HTML can load its sibling assets (styles.css,
 * _ds_bundle.js, fonts/*.woff2, etc.) exactly the way the uploaded payload
 * will be served, and so headless Chrome's CSP/module semantics behave like
 * a real page load instead of file://.
 *
 * Usage as a CLI:
 *   node serve.mjs <rootDir> [port]
 *
 * Usage as a module:
 *   import { createServer } from "./serve.mjs";
 *   const { server, port, url, close } = await createServer(rootDir, { port: 0 });
 */
import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function contentType(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

/**
 * Resolve a request URL to a path inside rootDir, refusing to escape it.
 * Returns null if the path would escape rootDir.
 */
function safeJoin(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;
  const root = resolve(rootDir);
  const full = resolve(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** Plain-text error response: never reflects request data, never sniffable. */
function plainError(res, status, message) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(message);
}

/**
 * Start a static server rooted at rootDir. Resolves once listening.
 * @param {string} rootDir absolute path to serve
 * @param {{port?: number, host?: string}} [opts] port 0 = pick a free port
 */
export function createServer(rootDir, opts = {}) {
  const host = opts.host || "127.0.0.1";
  const server = createHttpServer(async (req, res) => {
    try {
      // Chrome auto-probes /favicon.ico on every navigation; a 404 there
      // gets logged as a page console error (verified during dry-testing
      // against the reference payload) which would otherwise show up as a
      // false-positive render-check failure unrelated to the card itself.
      if ((req.url || "/").split("?")[0] === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      let targetPath = safeJoin(rootDir, req.url || "/");
      if (targetPath === null) {
        plainError(res, 403, "Forbidden");
        return;
      }
      let st;
      try {
        st = await stat(targetPath);
      } catch {
        plainError(res, 404, "Not found");
        return;
      }
      if (st.isDirectory()) {
        targetPath = join(targetPath, "index.html");
        try {
          st = await stat(targetPath);
        } catch {
          plainError(res, 404, "Not found");
          return;
        }
      }
      const body = await readFile(targetPath);
      res.writeHead(200, {
        "Content-Type": contentType(targetPath),
        "Content-Length": body.length,
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
    } catch (err) {
      console.error("[design-sync serve]", err);
      plainError(res, 500, "Server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      const url = `http://${host}:${port}`;
      resolve({
        server,
        port,
        url,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// CLI entry point: `node serve.mjs <rootDir> [port]`
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const rootArg = process.argv[2];
  const portArg = process.argv[3] ? Number(process.argv[3]) : 8917;
  if (!rootArg) {
    console.error("Usage: node serve.mjs <rootDir> [port]");
    process.exit(1);
  }
  const rootDir = normalize(fileURLToPath(new URL(rootArg, `file://${process.cwd()}/`)));
  const { url } = await createServer(rootDir, { port: portArg });
  console.log(`serving ${rootDir} at ${url}`);
}
