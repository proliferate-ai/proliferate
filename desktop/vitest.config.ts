import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@anyharness/sdk": fileURLToPath(new URL("../anyharness/sdk/src/index.ts", import.meta.url)),
      "@anyharness/sdk-react": fileURLToPath(
        new URL("../anyharness/sdk-react/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
