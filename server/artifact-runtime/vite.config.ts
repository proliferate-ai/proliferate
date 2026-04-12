import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  clearScreen: false,
  build: {
    outDir: "../proliferate/server/artifact_runtime/static",
    emptyOutDir: true,
  },
});
