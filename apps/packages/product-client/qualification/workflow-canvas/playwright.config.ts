import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "./specs",
  outputDir: `${fixtureDir}/test-results`,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5179",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite preview --config qualification/workflow-canvas/vite.config.ts",
    cwd: packageRoot,
    url: "http://127.0.0.1:5179",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
