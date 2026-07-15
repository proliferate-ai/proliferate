// Playwright globalSetup for the tier-2 BILLING-IMPORT suite
// (specs/billing-import/*, PR 4 workstream C).
//
// Separate project from the main billing suite (playwright.billing.config.ts):
// this one needs AGENT_GATEWAY_ENABLED + the LiteLLM management fake wired at
// boot time (server env, fixed at process start), which the main billing
// stack does not carry. Both boot the same `t2billing` profile but never
// concurrently — this project's own globalSetup/teardown fully owns the
// server process for its run, exactly like the main billing suite owns it for
// its own run (sequential `pnpm test:billing` / `pnpm test:billing-import`
// invocations, never run in parallel).
//
// skipFrontend: this suite is API + DB assertions only (import cursor,
// enrollment budget_status, usage-event ledger rows) — no UI, so no desktop
// web / AnyHarness runtime is booted.

import { bootBillingStackWithLitellmFake } from "./billing-usage-import.ts";
import { resetBillingState } from "./billing-seed.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

export default async function billingImportGlobalSetup(): Promise<() => Promise<void>> {
  const boot = await bootBillingStackWithLitellmFake();
  if (boot.skipped) {
    process.env.TIER2_BILLING_SKIP = "no-stripe-test-key";
    return async () => {};
  }

  await resetPasswordLoginRateLimits();
  // Same per-run reset as the main billing suite (billing-global-setup.ts):
  // wipe grant/subscription/enrollment/usage-event rows so this run's counts
  // are its own. Note `agent_llm_usage_import_cursor` is deliberately NOT
  // reset (it is a real singleton cursor, persists like production) — specs
  // account for an already-advanced cursor from a prior run by seeding spend
  // rows with a `startTime` at "now" (always inside the overlap window).
  await resetBillingState();
  return async () => {
    await boot.fake.close();
    await boot.stack.teardown();
  };
}
