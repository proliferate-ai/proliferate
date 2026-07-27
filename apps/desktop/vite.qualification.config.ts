import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Dedicated, isolated Vite config for the real ProductClient DESKTOP BUILD FIXTURE.
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
  // ProductClient's shared `@proliferate/design/product.css` is now the full
  // Tailwind entrypoint (`@import "tailwindcss"`, `@source`, `@utility`), so
  // the fixture needs the same Tailwind plugin as the real desktop app.
  plugins: [tailwindcss(), react()],
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
