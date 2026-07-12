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
// Missing, invalid, or live-mode credentials fail setup. A required billing
// run must never become green by skipping every test.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { BILLING_PROFILE, bootStack, REPO_ROOT, type StripeBillingEnv } from "./boot.ts";
import { resetBillingState } from "./billing-seed.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

function resolveStripeSecretKey(): string | null {
  const fromEnv =
    process.env.TIER2_BILLING_STRIPE_SECRET_KEY ||
    process.env.STRIPE_TEST_SECRET_KEY ||
    process.env.STRIPE_SECRET_KEY;
  if (fromEnv) {
    if (!fromEnv.startsWith("sk_test_")) {
      throw new Error(
        "Tier-2 billing requires a Stripe test-mode secret key (sk_test_...). " +
          "Refusing the configured non-test credential.",
      );
    }
    return fromEnv;
  }

  // CI must use the explicitly configured repository secret. The developer
  // CLI fallback is local-only so a hosted runner cannot silently use ambient
  // machine state instead of its declared dependency.
  if (process.env.CI) {
    return null;
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

function requiredCatalogId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Stripe test catalog is missing required ${name}.`);
  }
  return value;
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
  const parsed = JSON.parse(result.stdout) as Partial<PriceCatalog>;
  return {
    meter: { id: requiredCatalogId(parsed.meter?.id, "meter.id") },
    prices: {
      proMonthly: requiredCatalogId(parsed.prices?.proMonthly, "prices.proMonthly"),
      managedCloudOverageCent: requiredCatalogId(
        parsed.prices?.managedCloudOverageCent,
        "prices.managedCloudOverageCent",
      ),
      refill10h: requiredCatalogId(parsed.prices?.refill10h, "prices.refill10h"),
    },
  };
}

export default async function billingGlobalSetup(): Promise<() => Promise<void>> {
  const secretKey = resolveStripeSecretKey();
  if (!secretKey) {
    throw new Error(
      "Tier-2 billing requires STRIPE_TEST_SECRET_KEY with a Stripe test-mode " +
        "secret key (sk_test_...). The required suite cannot be skipped.",
    );
  }

  const catalog = provisionPriceCatalog(secretKey);
  const billingMode = process.env.TIER2_BILLING_MODE ?? "enforce";
  if (billingMode !== "enforce") {
    throw new Error(
      `Tier-2 billing requires TIER2_BILLING_MODE=enforce; received ${JSON.stringify(billingMode)}.`,
    );
  }
  const stripe: StripeBillingEnv = {
    secretKey,
    webhookSecret: `whsec_t2billing_${randomBytes(16).toString("hex")}`,
    proMonthlyPriceId: catalog.prices.proMonthly,
    overagePriceId: catalog.prices.managedCloudOverageCent,
    refillPriceId: catalog.prices.refill10h,
    meterId: catalog.meter.id,
    billingMode,
  };

  // Match the main intent suite's per-worktree profile override. The default
  // remains stable in CI, while local worktrees can run billing concurrently
  // without rebinding or disturbing another developer's t2billing profile.
  const stack = await bootStack({
    profile: process.env.TIER2_BILLING_PROFILE ?? BILLING_PROFILE,
    stripe,
  });

  try {
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
  } catch (error) {
    await stack.teardown();
    throw error;
  }
}
