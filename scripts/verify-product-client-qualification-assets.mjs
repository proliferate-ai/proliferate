import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!root || !existsSync(root)) {
  throw new Error(`Usage: node scripts/verify-product-client-qualification-assets.mjs <dist-dir>; missing ${root}`);
}

const manifestPath = join(root, ".vite", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const urls = new Set(["/index.html"]);
for (const entry of Object.values(manifest)) {
  if (entry.file) urls.add(`/${entry.file}`);
  for (const css of entry.css ?? []) urls.add(`/${css}`);
  for (const asset of entry.assets ?? []) urls.add(`/${asset}`);
}

const mimeTypes = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
  [".woff2", "font/woff2"],
]);

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = join(root, decodeURIComponent(pathname));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("content-type", mimeTypes.get(extname(filePath)) ?? "application/octet-stream");
  response.end(readFileSync(filePath));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();

try {
  for (const url of [...urls].sort()) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
  }
  console.log(`Verified ${urls.size} ProductClient qualification URLs from ${root}`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
