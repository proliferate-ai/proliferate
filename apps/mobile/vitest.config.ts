import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Node-environment vitest for mobile's pure, DOM-free logic modules
 * (capability parsing, readiness inputs/blocker, callback detection). React
 * Native component rendering is out of scope here — these are the same kind of
 * platform-free units the shared packages test. `@proliferate/product-domain`
 * resolves to source so the shared readiness resolver is exercised directly.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@proliferate/product-domain": fileURLToPath(
        new URL("../packages/product-domain/src", import.meta.url),
      ),
      "@anyharness/sdk": fileURLToPath(
        new URL("../../anyharness/sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
