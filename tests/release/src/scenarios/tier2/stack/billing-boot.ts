// Shared Tier-2 billing stack boot (PR 4, BRIEF §0).
//
// The ONE implementation of "resolve a Stripe test key → provision the local
// test-mode price catalog → boot the `t2billing` profile stack → publish the
// TIER2_BILLING_*/TIER2_INTENT_* env the billing harness reads". Both consumers
// call this — the Playwright `billing-global-setup.ts` (retained) and the
// `tests/release` Tier-2 adapter (`scenarios/tier2/harness.ts`) — so the boot is
// never forked. Extracted from `billing-global-setup.ts` without behavior
// change; that module is now a thin wrapper.
//
// Stripe posture is unchanged: a TEST key only (env or `stripe config --list`),
// never live mode; no key resolvable → the caller decides (Playwright skips the
// suite; the release adapter returns every financial cell BLOCKED — never
// green, never skip-as-success).

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { BILLING_PROFILE, bootStack, REPO_ROOT, type BootedStack, type StripeBillingEnv } from "./boot.ts";

export type BillingBootResult =
  | { skipped: true; reason: string }
  | { skipped: false; stack: BootedStack; stripe: StripeBillingEnv };

export interface BillingBootOptions {
  /** Extra/overriding server env (e.g. the LiteLLM management fake wiring the
   * import cells add — workstream C). Applied last, like `bootStack`. */
  extraServerEnv?: NodeJS.ProcessEnv;
  /** Skip the desktop web (Vite)/AnyHarness runtime boot — passthrough to
   * `bootStack` (workstream C's importer/exhaustion suite is API+DB only,
   * never UI, and skips this to cut boot cost). Default false (every other
   * caller's behavior is unchanged). */
  skipFrontend?: boolean;
}

/** Resolve a Stripe TEST secret key (env first, then the local `stripe` CLI
 * config); null when none is resolvable. Never returns a live key. */
export function resolveStripeSecretKey(): string | null {
  const fromEnv =
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_TEST_SECRET_KEY ||
    process.env.TIER2_BILLING_STRIPE_SECRET_KEY;
  if (fromEnv && fromEnv.startsWith("sk_test_")) {
    return fromEnv;
  }
  const result = spawnSync("stripe", ["config", "--list"], { encoding: "utf8" });
  if (result.status === 0) {
    const match = result.stdout.match(/test_mode_api_key\s*=\s*'([^']+)'/);
    if (match && match[1].startsWith("sk_test_")) {
      return match[1];
    }
  }
  return null;
}

export interface PriceCatalog {
  meter: { id: string };
  prices: { proMonthly: string; managedCloudOverageCent: string; refill10h: string };
}

/** Idempotent test-mode price catalog provisioning (never touches live mode). */
export function provisionPriceCatalog(secretKey: string): PriceCatalog {
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

/**
 * Boot the shared Tier-2 billing stack and publish the env the billing harness
 * (`billing-env.ts`) and the auth/org seed helpers (`seed.ts`) read. Caller owns
 * any per-run resets (`resetBillingState`, `resetPasswordLoginRateLimits`) and
 * teardown (`result.stack.teardown`).
 */
export async function bootBillingStack(options: BillingBootOptions = {}): Promise<BillingBootResult> {
  const secretKey = resolveStripeSecretKey();
  if (!secretKey) {
    return { skipped: true, reason: "no Stripe test key resolvable (env or `stripe config --list`)" };
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

  const stack = await bootStack({
    profile: BILLING_PROFILE,
    stripe,
    extraServerEnv: options.extraServerEnv,
    skipFrontend: options.skipFrontend,
  });

  // Billing harness (billing-env.ts) reads these.
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
  // billing stack: they key off TIER2_INTENT_* env.
  process.env.TIER2_INTENT_API_BASE_URL = stack.apiBaseUrl;
  process.env.TIER2_INTENT_WEB_BASE_URL = stack.webBaseUrl;
  process.env.TIER2_INTENT_DATABASE_URL = stack.databaseUrl;
  process.env.TIER2_INTENT_SETUP_TOKEN_FILE = stack.setupTokenFile;

  return { skipped: false, stack, stripe };
}
