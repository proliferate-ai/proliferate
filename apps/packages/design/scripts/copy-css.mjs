import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = resolve(root, "src/css");
const targetDir = resolve(root, "dist/css");

await mkdir(targetDir, { recursive: true });

for (const entry of await readdir(sourceDir)) {
  if (!entry.endsWith(".css")) {
    continue;
  }

  await copyFile(resolve(sourceDir, entry), resolve(targetDir, entry));
}

// The Geist @font-face declarations in src/css/product.css reference
// ../fonts/... relative to dist/css/product.css, so the woff2 files must ship
// inside dist. Resolve the geist package through the module resolver (its
// exports map hides the font files, so resolve a real entry and walk from it)
// instead of assuming a node_modules layout.
const require = createRequire(import.meta.url);
const geistDist = dirname(require.resolve("geist/font"));

for (const fontPath of [
  "geist-sans/Geist-Variable.woff2",
  "geist-mono/GeistMono-Variable.woff2",
]) {
  const target = resolve(root, "dist/fonts", fontPath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(geistDist, "fonts", fontPath), target);
}
