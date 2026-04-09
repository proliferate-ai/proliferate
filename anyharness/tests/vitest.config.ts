import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anyharness/sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    restoreMocks: true,
    fileParallelism: false,
  },
});
