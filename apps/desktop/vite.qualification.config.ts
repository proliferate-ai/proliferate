import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Dedicated, isolated Vite config for the ProductClient DESKTOP BUILD CANARY.
// It is intentionally separate from `vite.config.ts` so the normal desktop
// build (`pnpm --filter proliferate build`) is untouched: different root,
// different index.html, different output directory, and `manifest: true`
// enabled only here for the qualification asset/lazy-split inspection.
//
// Run with: vite build --config vite.qualification.config.ts
const root = fileURLToPath(
  new URL("./qualification/product-client", import.meta.url),
);
const outDir = fileURLToPath(
  new URL("./dist-product-client-qualification", import.meta.url),
);

export default defineConfig({
  root,
  plugins: [react()],
  // The canary imports shared product CSS as prebuilt plain CSS from
  // `@proliferate/design/product.css` (no Tailwind directives), so the Tailwind
  // plugin the real desktop app uses is not required to qualify the build.
  clearScreen: false,
  build: {
    outDir,
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    // Emit every asset as a real file (never an inlined data URI) so the
    // qualification proof can fetch each representative resource URL over HTTP
    // and assert it loads, rather than only proving a base64 inline.
    assetsInlineLimit: 0,
  },
});
