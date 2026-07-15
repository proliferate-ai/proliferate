import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// In-package `#product/*` imports resolve to source under test (never dist),
// mirroring the tsconfig `paths` mapping. Runtime resolution is a separate
// concern: package.json `imports` points `#product/*` at compiled `dist`.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^#product\//, replacement: `${srcDir}/` }],
  },
  test: {},
});
