import { defineConfig } from "@playwright/test";

// Tier-2 BILLING suite (specs/developing/testing/scenarios.md T2-BILL-1..9).
// Separate config from the auth/org intent suite: it boots its own stack with
// Stripe test mode + enforcement on (stack/billing-global-setup.ts), on the
// dedicated `t2billing` profile. Serial, single worker, one stack per run —
// every spec shares one claimed org and one Postgres DB, and the billing state
// (grants, subscriptions, holds) must not race across workers.
export default defineConfig({
  testDir: "./specs/billing",
  globalSetup: "./stack/billing-global-setup.ts",
  workers: 1,
  fullyParallel: false,
  // Real Stripe test-clock round-trips and out-of-process accounting passes
  // are slower than the auth suite; give tests headroom. One retry collects a
  // second diagnostic sample, but the strict reporter keeps a flaky run red.
  retries: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [["list"], ["github"], ["./stack/strict-reporter.ts"]]
    : [["list"], ["./stack/strict-reporter.ts"]],
  use: {
    baseURL: process.env.TIER2_BILLING_WEB_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
