import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Minimal PRODUCTION Vite build for the browser build fixture. It lives inside
// the product-client package and imports the build canary through the package's
// public export map, proving external host resolution end to end. `manifest`
// is enabled so the verification script can assert the lazy authenticated split
// and fetch every emitted asset URL.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    // Emit every asset as a real file (never an inlined data URI) so the
    // qualification proof can fetch each representative resource URL over HTTP
    // and assert it loads, rather than only proving a base64 inline.
    assetsInlineLimit: 0,
  },
});
