#!/usr/bin/env node
/**
 * Compiles `.out/.ds-entry.tsx` (written by make-entry.mjs) into
 * `.out/_ds_bundle.js`: a Vite lib-mode IIFE, global name `ProliferateUI`,
 * with React aliased to the window-global shims in shims/ so the bundle
 * carries no React copy of its own (CONTRACT.md "React MUST be external").
 * Prepends the `/* @ds-bundle: ... *\/` manifest comment and appends an
 * explicit `window.ProliferateUI = ...` epilogue.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const productClientDir = join(repo, "apps/packages/product-client");
const srcDir = join(productClientDir, "src");
const outDir = join(here, ".out");
const entryPath = join(outDir, ".ds-entry.tsx");
const manifestSidecarPath = join(outDir, ".ds-registry-manifest.json");

if (!existsSync(entryPath) || !existsSync(manifestSidecarPath)) {
  throw new Error(
    "build-bundle: missing .out/.ds-entry.tsx or .out/.ds-registry-manifest.json — run make-entry.mjs first.",
  );
}

const pcRequire = createRequire(join(productClientDir, "package.json"));
const viteMain = pcRequire.resolve("vite");
const { build } = await import(pathToFileURL(viteMain).href);

const shimsDir = join(here, "shims");

const warnings = [];

await build({
  configFile: false,
  root: productClientDir,
  logLevel: "warn",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      // #product/* resolves to the compiled `dist/` via package.json
      // "imports" by default (which doesn't exist here) — force it to the
      // live source tree instead, mirroring vitest.config.ts.
      { find: /^#product\//, replacement: `${srcDir}/` },
      // Sever React from the bundle: these must come before nothing else
      // matches them first — react-dom/client is listed ahead of the plain
      // react-dom alias since Vite's alias matcher treats a string `find`
      // as a prefix match (id === find OR id.startsWith(find + "/")), so
      // "react-dom" would otherwise also swallow "react-dom/client".
      { find: "react/jsx-dev-runtime", replacement: join(shimsDir, "jsx-dev-runtime.mjs") },
      { find: "react/jsx-runtime", replacement: join(shimsDir, "jsx-runtime.mjs") },
      { find: "react-dom/client", replacement: join(shimsDir, "react-dom-client.mjs") },
      { find: "react-dom", replacement: join(shimsDir, "react-dom.mjs") },
      { find: "react", replacement: join(shimsDir, "react.mjs") },
    ],
  },
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: entryPath,
      formats: ["iife"],
      name: "ProliferateUI",
      fileName: () => "_ds_bundle.js",
    },
    rollupOptions: {
      onwarn(warning, warn) {
        warnings.push(warning);
        warn(warning);
      },
    },
  },
});

const ambiguousExportWarnings = warnings.filter(
  (warning) =>
    warning.code === "NAMESPACE_CONFLICT" ||
    /ambiguous/i.test(warning.message ?? "") ||
    /re-exported/i.test(warning.message ?? ""),
);
if (ambiguousExportWarnings.length > 0) {
  console.error(
    `build-bundle: ${ambiguousExportWarnings.length} ambiguous-export warning(s) from Rollup — pin these in make-entry.mjs's PIN_EXPORTS:`,
  );
  for (const warning of ambiguousExportWarnings) {
    console.error(`  - ${warning.message}`);
  }
  // An ambiguous export means Rollup silently drops the binding from the
  // namespace — the component would ship broken, so refuse to build.
  throw new Error("build-bundle: unresolved export collision(s), see above");
}
if (warnings.some((w) => /from "react"|from 'react'/.test(w.message ?? ""))) {
  console.warn("build-bundle: a warning mentioned a bare react import — verify the alias caught it.");
}

// --- Manifest comment (first line) -----------------------------------
const registryEntries = JSON.parse(readFileSync(manifestSidecarPath, "utf8"));

function groupFor(name, tierId) {
  if (name.startsWith("Composer") || name === "LevelBarsButton") return "composer";
  if (name === "ToastHost" || name === "Sonner" || name.startsWith("Toast")) return "toast";
  if (name.startsWith("Sidebar")) return "sidebar";
  if (name.startsWith("Settings")) return "settings";
  return tierId;
}

function resolveSourceFile(subpath) {
  const rest = subpath.replace(/^#product\//, "");
  const candidates = [
    `${join(srcDir, rest)}.tsx`,
    `${join(srcDir, rest)}.ts`,
    join(srcDir, rest, "index.tsx"),
    join(srcDir, rest, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`build-bundle: could not resolve source file for subpath "${subpath}" (tried: ${candidates.join(", ")})`);
}

function sha256_12(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

const components = [];
const sourceHashes = {};
for (const entry of registryEntries) {
  // Slash-bearing registry names (secrets/SecretManagementPanel) sanitize to
  // their last segment for file paths — must match emit-cards/make-meta.
  const displayName = entry.name.split("/").pop();
  const group = groupFor(displayName, entry.tierId);
  const sourcePath = `components/${group}/${displayName}/${displayName}.jsx`;
  components.push({ name: entry.name, sourcePath });

  const resolved = resolveSourceFile(entry.subpath);
  sourceHashes[sourcePath] = sha256_12(readFileSync(resolved));
}

const manifest = {
  namespace: "ProliferateUI",
  components,
  sourceHashes,
  inlinedExternals: [],
  builtBy: "proliferate-design-sync",
};
const manifestComment = `/* @ds-bundle: ${JSON.stringify(manifest)} */`;

// --- Assemble final bundle --------------------------------------------
const bundlePath = join(outDir, "_ds_bundle.js");
const built = readFileSync(bundlePath, "utf8");

// Vite's iife wrapper already assigns `var ProliferateUI = (...)(...)`. A
// bare top-level `var` in a browser <script> becomes a `window` property
// implicitly, but CONTRACT.md asks for an explicit epilogue (like the
// reference payload's `window.ProliferateUI = ...` tail line) so the global
// is unambiguous regardless of how the script is loaded/wrapped.
const epilogue = "\nwindow.ProliferateUI = ProliferateUI;\n";

writeFileSync(bundlePath, `${manifestComment}\n${built}${epilogue}`);

console.log(
  `build-bundle: wrote ${bundlePath} (${components.length} components, ${ambiguousExportWarnings.length} ambiguous-export warning(s))`,
);
