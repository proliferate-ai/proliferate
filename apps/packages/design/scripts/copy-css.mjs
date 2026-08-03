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

/* ------------------------------------------------------------------ *
 * Geist ships as a bare package with no stylesheet of its own, so the
 * `@font-face` rules live in product.css. They used to point at absolute
 * `/node_modules/geist/...` URLs, which only resolve because a dev server
 * happens to serve node_modules — any other bundler or deploy target got a
 * dangling rule and silently fell back to a system mono font.
 *
 * Copying the woff2s next to the emitted CSS lets product.css reference them
 * relatively (`../fonts/…`), so the declaration resolves wherever the package
 * is consumed from. `@fontsource-variable/*` needs no equivalent step: those
 * packages ship their own CSS and their own fonts.
 * ------------------------------------------------------------------ */

// `geist` does not export `./package.json`, so resolve through `./font` (which
// maps to `dist/font.js`) and walk to the sibling `fonts/` directory. This
// works regardless of how pnpm hoists the package.
const require = createRequire(import.meta.url);
const geistFontsDir = resolve(dirname(require.resolve("geist/font")), "fonts");
const fontsTargetDir = resolve(root, "dist/fonts");

await mkdir(fontsTargetDir, { recursive: true });

for (const relativePath of [
  "geist-sans/Geist-Variable.woff2",
  "geist-mono/GeistMono-Variable.woff2",
]) {
  const source = resolve(geistFontsDir, relativePath);
  const target = resolve(fontsTargetDir, relativePath.split("/").at(-1));
  await copyFile(source, target);
  console.log(`copy-css: geist ${relativePath} -> dist/fonts/`);
}
