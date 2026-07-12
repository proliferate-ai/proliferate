import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs/surfaces",
  globalSetup: "./stack/surfaces-global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // A retry, skip, fixme, or missing expected surface is non-qualifying just
  // like every other required Tier-2 row.
  reporter: process.env.CI
    ? [["list"], ["github"], ["./stack/strict-reporter.ts"]]
    : [["list"], ["./stack/strict-reporter.ts"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-web",
      testMatch: "shared/**/*.surface.spec.ts",
    },
    {
      name: "hosted-web",
      testMatch: "shared/**/*.surface.spec.ts",
    },
    {
      name: "cross-surface",
      testMatch: "cross/**/*.cross.spec.ts",
    },
  ],
});
