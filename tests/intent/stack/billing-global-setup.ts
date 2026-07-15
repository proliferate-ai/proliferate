// Playwright globalSetup for the tier-2 BILLING suite (specs/billing/*).
//
// Thin wrapper over the shared `bootBillingStack()` (stack/billing-boot.ts), so
// the Playwright suite and the tests/release Tier-2 adapter share ONE boot
// implementation (BRIEF §0). Behavior is unchanged from the pre-PR-4 module:
// no Stripe test key → the whole suite is skipped (not failed), matching the
// provisional, non-blocking posture while the harness earns trust.

import { bootBillingStack } from "./billing-boot.ts";
import { resetBillingState } from "./billing-seed.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

export class BillingSuiteSkipped extends Error {}

export default async function billingGlobalSetup(): Promise<() => Promise<void>> {
  const boot = await bootBillingStack();
  if (boot.skipped) {
    // No Stripe test key → skip the suite. Publish a flag every spec's
    // top-level guard reads; Playwright's own skip is per-test. Nothing booted;
    // teardown is a no-op.
    process.env.TIER2_BILLING_SKIP = "no-stripe-test-key";
    return async () => {};
  }

  await resetPasswordLoginRateLimits();
  // Billing rows accumulate in the persistent profile DB; wipe them so this
  // run's grant/adjustment/export assertions count only their own effects
  // (accounts and org memberships are preserved — see resetBillingState).
  await resetBillingState();
  return boot.stack.teardown;
}
