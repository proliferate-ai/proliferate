import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// The test lane reuses the app's Vite pipeline (React plugin, `define`, the
// `react`/`react-dom` dedupe) and adds only the test settings. Node by default
// (as Desktop/product-client); a DOM is opted into per-file via a
// `// @vitest-environment jsdom` pragma where a host route/provider is rendered.
// Kept out of `tsconfig.json` `include` so the app typecheck is not coupled to
// the vitest/config type surface (which resolves a second Vite copy).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  }),
);
