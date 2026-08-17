import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// QUALIFICATION-ONLY scroll-physics fixture host. It serves a single page that
// mounts the REAL transcript component (`MessageList`) driven by the REAL
// `@anyharness/sdk` reducer, so Playwright can measure scroll physics in real
// Chromium and WebKit. Like the browser-build fixture next door, it consumes
// the package's own built output through the private `#product/*` import map
// (default condition -> `./dist/*.js`), so `pnpm shared:build` must have run
// first. This keeps the fixture on the exact code that ships instead of a
// re-aliased source copy.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  // Tailwind v4 compiles utilities at the consumer bundle step by scanning the
  // `@source` globs declared in `@proliferate/design/product.css` (which reach
  // into product-client/src), so the transcript's `overflow-y-auto`,
  // `flex-1 min-h-0`, etc. only exist when this plugin runs.
  plugins: [react(), tailwindcss()],
  // Deterministic single-page dev server. No HMR-driven remounts mid-test:
  // the Playwright driver owns all state transitions through `window.__scrollPhysics`.
  server: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
    hmr: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
  },
});
