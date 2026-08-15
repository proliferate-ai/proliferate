#!/usr/bin/env node
/**
 * Builds `.out/_vendor/react.js`: one IIFE bundling the repo's
 * react@19.2.8 + react-dom + react-dom/client into `window.React` /
 * `window.ReactDOM` (with `createRoot` merged in), matching the reference
 * payload's `_vendor/react.js` (see CONTRACT.md "React MUST be external to
 * `_ds_bundle.js`"). Also writes `.out/_vendor/react-dom.js`, an intentional
 * stub (that file is merged into react.js and never separately loaded).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const productClientDir = join(repo, "apps/packages/product-client");
const vendorOutDir = join(here, ".out", "_vendor");
mkdirSync(vendorOutDir, { recursive: true });

// Resolve exactly the copies under apps/packages/product-client/node_modules
// (per CONTRACT.md "Tooling"), not whatever `react` a naive bare-specifier
// resolve might turn up elsewhere in the workspace.
const pcRequire = createRequire(join(productClientDir, "package.json"));
const reactMain = pcRequire.resolve("react");
const reactDomMain = pcRequire.resolve("react-dom");
const reactDomClientMain = pcRequire.resolve("react-dom/client");
const viteMain = pcRequire.resolve("vite");

const { build } = await import(pathToFileURL(viteMain).href);

// Physical (debuggable) entry file, written into our own .out/ scratch dir.
// The bare "react" / "react-dom" / "react-dom/client" specifiers below are
// redirected to their exact resolved files via resolve.alias, so this file
// never depends on where it happens to live on disk.
const vendorEntryPath = join(here, ".out", ".vendor-react-entry.mjs");
writeFileSync(
  vendorEntryPath,
  `import * as ReactNS from "react";
import * as ReactDOMNS from "react-dom";
import * as ReactDOMClientNS from "react-dom/client";

window.__dsReact = ReactNS.default && ReactNS.default.createElement ? ReactNS.default : ReactNS;
window.__dsReactDOM = Object.assign({}, ReactDOMNS.default ?? ReactDOMNS, ReactDOMNS, ReactDOMClientNS.default ?? {}, ReactDOMClientNS);
`,
);

await build({
  configFile: false,
  root: productClientDir,
  logLevel: "warn",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: [
      { find: "react-dom/client", replacement: reactDomClientMain },
      { find: "react-dom", replacement: reactDomMain },
      { find: "react", replacement: reactMain },
    ],
  },
  build: {
    outDir: vendorOutDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: vendorEntryPath,
      formats: ["iife"],
      name: "__DsVendorReactBuild",
      fileName: () => "react.js",
    },
  },
});

// Vite's iife wrapper only assigns its `name` global when the entry has
// exports; ours is pure side effect (it sets window.__dsReact /
// window.__dsReactDOM), so what matters is the epilogue below, appended the
// same way the reference payload's _vendor/react.js ends: promote the temp
// globals to window.React / window.ReactDOM, then delete the temps.
const reactJsPath = join(vendorOutDir, "react.js");
const built = readFileSync(reactJsPath, "utf8");
const epilogue =
  '\n;window.React=window.React||window.__dsReact;window.ReactDOM=window.ReactDOM||window.__dsReactDOM;try{delete window.__dsReact;delete window.__dsReactDOM;}catch(e){}\n';
writeFileSync(reactJsPath, built + epilogue);

// Stub companion file — react-dom.js content is folded into react.js above;
// this file exists only so the payload's expected file list is complete.
writeFileSync(join(vendorOutDir, "react-dom.js"), "/* merged into react.js */");

console.log(`build-vendor-react: wrote ${reactJsPath} (${(built.length + epilogue.length)} bytes) + react-dom.js stub`);
