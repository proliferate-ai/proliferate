import { defineConfig } from "vite";

export default defineConfig({
  base: "/artifact-runtime/",
  clearScreen: false,
  build: {
    outDir: "../proliferate/server/artifact_runtime/static",
    emptyOutDir: true,
  },
});
