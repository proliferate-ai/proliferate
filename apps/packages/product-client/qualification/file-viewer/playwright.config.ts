import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "./specs",
  outputDir: `${fixtureDir}/test-results`,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  // The dock focuses its filter input on open, so every dock screenshot would
  // otherwise race the blinking text caret.
  expect: { timeout: 10_000, toHaveScreenshot: { caret: "hide" } },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5180",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 960, height: 720 },
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite preview --config qualification/file-viewer/vite.config.ts",
    cwd: packageRoot,
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
