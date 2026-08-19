import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Qualification-only host for the shipped file-reference and viewer build.
// Package-private #product imports resolve through ProductClient's dist map.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5180, strictPort: true, hmr: false },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
});
