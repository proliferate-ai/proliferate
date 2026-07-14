import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    outDir: "dist",
    emptyOutDir: true,
  },
});
