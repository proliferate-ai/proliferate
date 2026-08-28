import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The product-client package root (two levels up from this fixture). Vite is
// resolved from there; the fixture dir itself has no package.json, so a bare
// `pnpm exec` there escalates to the workspace root and cannot find vite.
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDir = fileURLToPath(new URL(".", import.meta.url));

// Scroll-physics tier (specs/engineering/testing/README.md, Tier-2-style merge-gating suite).
// Real transcript renderer in real Chromium AND real WebKit, driving a scripted
// streaming fixture through the REAL @anyharness/sdk reducer. Everything
// external (server, sandbox, LLM, network) is absent; the fixture is fully
// deterministic and owns every state transition via `window.__scrollPhysics`.
//
// workers:1 / fullyParallel:false is a hard requirement here for two reasons:
// (1) scroll physics is measured against a single shared viewport and per-frame
// scrollTop traces, which must not contend with sibling browser contexts; and
// (2) the shared dev machine has OOM-crashed under concurrent browser load.
export default defineConfig({
  testDir: "./specs",
  // Keep run artifacts inside the fixture dir (gitignored there) rather than at
  // the package root, wherever the runner's CWD happens to be.
  outputDir: `${fixtureDir}/test-results`,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A physics gate: flake must show up red, not hide behind a retry.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure",
    // Headless is mandatory on the shared machine.
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    // `vite preview` serves a prebuilt bundle deterministically; the CI job
    // builds the fixture first (`vite build`) so no on-the-fly compilation
    // races the first test. Locally the same command works after a build.
    command: "pnpm exec vite preview --config qualification/scroll-physics/vite.config.ts",
    cwd: packageRoot,
    url: "http://127.0.0.1:5178",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
