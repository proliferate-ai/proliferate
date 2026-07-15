import { defineConfig } from "@playwright/test";

// Tier-2 mocked-intent suite (specs/developing/testing/README.md §Tier 2).
// One stack boot per run (globalSetup), spec files run serially within a
// single worker: the suite shares one claimed single-org instance and one
// Postgres DB, so parallel workers would race on org/invitation state.
export default defineConfig({
  testDir: "./specs",
  // The billing specs live under ./specs/billing but boot a different stack
  // (Stripe + enforce mode) via their own config; keep them out of this suite.
  testIgnore: "**/billing/**",
  globalSetup: "./stack/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  // Local runs and CI both get one retry: the stack is real (uvicorn + vite
  // cold start), not mocked, so first-contact flake is possible; a green
  // retry is meaningful, repeated red is a real failure.
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: process.env.TIER2_INTENT_WEB_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
