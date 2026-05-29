import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anyharness/sdk": fileURLToPath(
        new URL("../../../anyharness/sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
