import { defineConfig } from "@playwright/test";

// Tier-2 BILLING-IMPORT suite (PR 4 workstream C; feeds T2-BILL-15/T2-BILL-6's
// exhaustion assertion). Separate config from playwright.billing.config.ts:
// this project boots its own stack with AGENT_GATEWAY_ENABLED + the LiteLLM
// management fake wired at server-start time
// (stack/billing-import-global-setup.ts), on the same `t2billing` profile —
// never run concurrently with the main billing project (see that module's
// header comment). API + DB assertions only, no UI: `skipFrontend` in the
// boot skips the desktop web/AnyHarness runtime entirely.
export default defineConfig({
  testDir: "./specs/billing-import",
  globalSetup: "./stack/billing-import-global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
