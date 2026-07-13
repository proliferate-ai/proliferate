/**
 * Idempotent Stripe test-mode price/meter catalog provisioning, mirroring
 * tests/intent/stack/billing-global-setup.ts's convention exactly (same
 * script, same env-passing shape) so both suites' Stripe test accounts agree.
 * Never touches live mode — `scripts/stripe-setup-test-mode.mjs` only ever
 * creates/looks-up test-mode objects by lookup key.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { StripeBillingEnvLike } from "./intent-bridge.js";

interface PriceCatalog {
  meter: { id: string };
  prices: { proMonthly: string; managedCloudOverageCent: string; refill10h: string };
}

export function provisionStripeTestBillingEnv(secretKey: string, repoRoot: string, billingMode = "enforce"): StripeBillingEnvLike {
  const result = spawnSync("node", ["scripts/stripe-setup-test-mode.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, STRIPE_API_KEY: secretKey },
  });
  if (result.status !== 0) {
    throw new Error(`stripe-setup-test-mode.mjs failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const catalog = JSON.parse(result.stdout) as PriceCatalog;
  return {
    secretKey,
    webhookSecret: `whsec_tf_tier2_${randomBytes(16).toString("hex")}`,
    proMonthlyPriceId: catalog.prices.proMonthly,
    overagePriceId: catalog.prices.managedCloudOverageCent,
    refillPriceId: catalog.prices.refill10h,
    meterId: catalog.meter.id,
    billingMode,
  };
}
