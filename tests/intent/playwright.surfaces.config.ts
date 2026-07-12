import { defineConfig } from "@playwright/test";

// This config proves the dual-host harness and provides the lane shape for
// later host-neutral product-flow specs. The initial specs are readiness and
// shared-control-plane checks; they do not claim chat/settings/billing parity.
export default defineConfig({
  testDir: "./specs/surfaces",
  globalSetup: "./stack/surfaces-global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
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
