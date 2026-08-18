import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Qualification-only host for real browser stacking and hit-testing. The
// private #product import resolves to dist, so the fixture executes the exact
// production canvas build rather than a source-only or simulated substitute.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5179, strictPort: true, hmr: false },
  preview: { host: "127.0.0.1", port: 5179, strictPort: true },
});
