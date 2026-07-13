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
  // TIER2_INTENT_EXTERNAL_STACK=1: a caller outside this suite (currently
  // tests/release's Tier2WorldProvisioner, specs/developing/testing/
  // release-worlds-and-fixtures.md's world-adapter contract) already booted
  // and owns the lifecycle of a compatible stack, and published its
  // connection info under the same TIER2_INTENT_* env vars this globalSetup
  // would otherwise set itself. Skip booting a second, redundant stack; just
  // do the per-run hygiene this suite always needs and hand back a no-op
  // teardown, since the caller — not this process — owns shutdown.
  if (process.env.TIER2_INTENT_EXTERNAL_STACK === "1") {
    if (!process.env.TIER2_INTENT_API_BASE_URL || !process.env.TIER2_INTENT_WEB_BASE_URL) {
      throw new Error(
        "TIER2_INTENT_EXTERNAL_STACK=1 requires TIER2_INTENT_API_BASE_URL and TIER2_INTENT_WEB_BASE_URL " +
          "to already be set by the external caller that booted the stack.",
      );
    }
    await resetPasswordLoginRateLimits();
    return async () => {};
  }

  const stack = await bootStack();
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
