import { defineConfig } from "@playwright/test";

// Tier-2 mocked-intent suite (specs/developing/testing/README.md §Tier 2).
// One stack boot per run (globalSetup), spec files run serially within a
// single worker: the suite shares one claimed single-org instance and one
// Postgres DB, so parallel workers would race on org/invitation state.
export default defineConfig({
  testDir: "./specs",
  // Billing and dual-host readiness each own a different stack/config. The
  // surface lane is intentionally not part of this strict canonical gate until
  // it has the required-surface manifest and real shared product journeys.
  testIgnore: ["**/billing/**", "**/surfaces/**"],
  globalSetup: "./stack/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  // One retry gathers a second diagnostic sample for real uvicorn/Vite startup
  // failures. The strict reporter still leaves the required run red when a
  // test passes only on retry; retries never convert flakiness into a green gate.
  retries: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["github"], ["./stack/strict-reporter.ts"]]
    : [["list"], ["./stack/strict-reporter.ts"]],
  use: {
    baseURL: process.env.TIER2_INTENT_WEB_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
