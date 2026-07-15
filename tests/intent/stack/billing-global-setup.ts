// Playwright globalSetup for the tier-2 BILLING suite (specs/billing/*).
//
// Separate from the auth/org global-setup because billing needs its own server
// posture: pro billing enabled, CLOUD_BILLING_MODE=enforce, and real Stripe
// test-mode keys/prices wired in. It boots the dedicated `t2billing` profile
// (one profile per suite, per specs/developing/local/dev-profiles.md) so it
// never collides with the auth/org `t2intent` DB.
//
// Stripe requirement: the suite needs a Stripe TEST secret key and the local
// test-mode price catalog (scripts/stripe-setup-test-mode.mjs, idempotent).
// If no Stripe test key is resolvable (e.g. a CI job without the secret), the
// whole suite is skipped rather than failing — matching the provisional,
// non-blocking posture of the intent-tests workflow while the harness earns
// trust.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { BILLING_PROFILE, bootStack, REPO_ROOT, type StripeBillingEnv } from "./boot.ts";
import { resetBillingState } from "./billing-seed.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

export class BillingSuiteSkipped extends Error {}

function resolveStripeSecretKey(): string | null {
  const fromEnv =
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_TEST_SECRET_KEY ||
    process.env.TIER2_BILLING_STRIPE_SECRET_KEY;
  if (fromEnv && fromEnv.startsWith("sk_test_")) {
    return fromEnv;
  }
  // Fall back to the developer's Stripe CLI config (test_mode_api_key), the
  // same key `stripe config --list` prints locally.
  const result = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
  if (result.status === 0) {
    const match = result.stdout.match(/test_mode_api_key\s*=\s*'([^']+)'/);
    if (match && match[1].startsWith("sk_test_")) {
      return match[1];
    }
  }
  return null;
}

interface PriceCatalog {
  meter: { id: string };
  prices: { proMonthly: string; managedCloudOverageCent: string; refill10h: string };
}

function provisionPriceCatalog(secretKey: string): PriceCatalog {
  // Idempotent: finds existing test-mode prices by lookup key, creates only
  // what's missing. Never touches live mode. The script shells out to the
  // `stripe` CLI without --api-key, so pass the resolved key via the CLI's
  // STRIPE_API_KEY env var — CI runners have no `stripe login` config.
  const result = spawnSync("node", ["scripts/stripe-setup-test-mode.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, STRIPE_API_KEY: secretKey },
  });
  if (result.status !== 0) {
    throw new Error(`stripe-setup-test-mode.mjs failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout) as PriceCatalog;
}

export default async function billingGlobalSetup(): Promise<() => Promise<void>> {
  const secretKey = resolveStripeSecretKey();
  if (!secretKey) {
    // No Stripe test key → skip the suite (see header). Publish a flag every
    // spec's top-level guard reads; Playwright's own skip is per-test.
    process.env.TIER2_BILLING_SKIP = "no-stripe-test-key";
    // Nothing booted; teardown is a no-op.
    return async () => {};
  }

  const catalog = provisionPriceCatalog(secretKey);
  const stripe: StripeBillingEnv = {
    secretKey,
    webhookSecret: `whsec_t2billing_${randomBytes(16).toString("hex")}`,
    proMonthlyPriceId: catalog.prices.proMonthly,
    overagePriceId: catalog.prices.managedCloudOverageCent,
    refillPriceId: catalog.prices.refill10h,
    meterId: catalog.meter.id,
    billingMode: process.env.TIER2_BILLING_MODE ?? "enforce",
  };

  const stack = await bootStack({ profile: BILLING_PROFILE, stripe });

  // Billing harness (stack/billing.ts) reads these.
  process.env.TIER2_BILLING_API_BASE_URL = stack.apiBaseUrl;
  process.env.TIER2_BILLING_WEB_BASE_URL = stack.webBaseUrl;
  process.env.TIER2_BILLING_DATABASE_URL = stack.databaseUrl;
  process.env.TIER2_BILLING_STRIPE_SECRET_KEY = stripe.secretKey;
  process.env.TIER2_BILLING_STRIPE_WEBHOOK_SECRET = stripe.webhookSecret;
  process.env.TIER2_BILLING_STRIPE_PRO_MONTHLY_PRICE_ID = stripe.proMonthlyPriceId;
  process.env.TIER2_BILLING_STRIPE_OVERAGE_PRICE_ID = stripe.overagePriceId;
  process.env.TIER2_BILLING_STRIPE_REFILL_PRICE_ID = stripe.refillPriceId;
  process.env.TIER2_BILLING_STRIPE_METER_ID = stripe.meterId;

  // Reuse seed.ts's auth/org helpers (claim, login, invite) against this same
  // billing stack: they key off TIER2_INTENT_* env, so point those here too.
  // The two suites never share a process (separate playwright configs).
  process.env.TIER2_INTENT_API_BASE_URL = stack.apiBaseUrl;
  process.env.TIER2_INTENT_WEB_BASE_URL = stack.webBaseUrl;
  process.env.TIER2_INTENT_DATABASE_URL = stack.databaseUrl;
  process.env.TIER2_INTENT_SETUP_TOKEN_FILE = stack.setupTokenFile;

  await resetPasswordLoginRateLimits();
  // Billing rows accumulate in the persistent profile DB; wipe them so this
  // run's grant/adjustment/export assertions count only their own effects
  // (accounts and org memberships are preserved — see resetBillingState).
  await resetBillingState();
  return stack.teardown;
}
