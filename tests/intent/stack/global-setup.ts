// Playwright globalSetup adapter around stack/boot.ts. Boots the stack once
// for the whole run, publishes connection info to every test worker via
// env vars (workers are spawned by Playwright after this resolves, so they
// inherit process.env as set here), and returns the teardown callback —
// Playwright calls a function returned from globalSetup as globalTeardown
// automatically, run in the same process so the child-process handles this
// module closed over stay valid.

import { bootStack } from "./boot.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await bootStack({
    profile: process.env.TIER2_INTENT_PROFILE || undefined,
    extraServerEnv: {
      // Keep the external worker phase stopped: tier-2 intent specs prove
      // product journeys without background execution.
      RUN_BACKGROUND_WORKERS: "false",
    },
    extraDesktopEnv: {
      // T2-WFDEF-1 / T2-WF-1 drive the gen-2 workflows surface, which ships
      // behind the workflows_v2 gate (product-client
      // lib/domain/capabilities/workflows-v2.ts). "1" forces it on whatever
      // WORKFLOWS_V2_DEFAULT currently is, so those specs neither depend on
      // the launch default nor break when it flips. The suite shares one Vite
      // process, so this is necessarily run-wide; no other spec asserts the
      // absence of the workflows surface.
      VITE_WORKFLOWS_V2: "1",
    },
  });
  process.env.TIER2_INTENT_API_BASE_URL = stack.apiBaseUrl;
  process.env.TIER2_INTENT_WEB_BASE_URL = stack.webBaseUrl;
  process.env.TIER2_INTENT_ANYHARNESS_BASE_URL = stack.anyharnessBaseUrl;
  process.env.TIER2_INTENT_DATABASE_URL = stack.databaseUrl;
  process.env.TIER2_INTENT_SETUP_TOKEN_FILE = stack.setupTokenFile;
  // The profile DB persists between runs; failed-login counters from a prior
  // run's negatives must not 429 this run's logins (5 failures / 15 min / IP).
  await resetPasswordLoginRateLimits();
  return stack.teardown;
}
