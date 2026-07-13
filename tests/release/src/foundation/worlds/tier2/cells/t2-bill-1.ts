/**
 * T2-BILL-1 vertical-slice cell: the smallest real checkout-to-grant
 * assertion from the existing `tests/intent/specs/billing` suite — a real
 * Stripe test-mode subscription + `invoice.paid` webhook issues the
 * `pro_period` managed-compute grant. Deliberately narrower than the full
 * `T2-BILL-1` manifest row (core-release-validation.md), which additionally
 * requires consumption, cut-off, top-up/reactivation, and drain ordering —
 * this cell's `dimensions.slice` marks it as the foundation vertical slice,
 * not a claim of full-row coverage (core-release-validation.md's "honest
 * vertical slice" ratchet).
 *
 * Exercises the trusted secret preflight contract end to end:
 *   - Stripe present (`handle.stripe` resolved by the provisioner) -> runs for
 *     real in Stripe test mode against the booted world.
 *   - Stripe absent -> returns "blocked" so diagnostic runs report it and
 *     continue, while the caller's strict evaluation (fed a preflight with
 *     `complete: false`) fails the run — see secret-preflight.test.ts for the
 *     two paths asserted against a FAKE preflight, and
 *     run-vertical-slice.ts for wiring the real one.
 *
 * Reuses tests/intent/stack/{seed,billing,billing-seed,billing-env}.ts's real
 * Stripe-CLI + webhook-delivery + Postgres helpers directly (in-process, no
 * browser needed for this slice) rather than re-implementing them.
 */

import type { CleanupLedger } from "../../../contracts/cleanup.js";
import type { EvidenceSink } from "../../../contracts/evidence.js";
import type { CellIdentity } from "../../../contracts/identity.js";
import type { FinalCellResult } from "../../../contracts/results.js";
import { loadBillingModule, loadSeedModule } from "../support/intent-bridge.js";
import { runCell, type CellOutcome } from "../cell-runner.js";
import type { InternalTier2WorldHandle } from "../provisioner.js";

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

const CELL: CellIdentity = {
  scenarioId: "T2-BILL-1",
  world: "tier-2",
  productHost: "desktop-web",
  dimensions: { slice: "checkout-to-grant" },
};

/** Bridges the world handle's connection info onto the env vars
 * tests/intent/stack/{seed,billing-env}.ts read, since this cell calls those
 * helpers in-process rather than through a spawned Playwright worker. */
function bridgeEnv(handle: InternalTier2WorldHandle, stripe: NonNullable<InternalTier2WorldHandle["stripe"]>): void {
  process.env.TIER2_INTENT_API_BASE_URL = handle.serverUrl;
  process.env.TIER2_INTENT_WEB_BASE_URL = handle.webUrl;
  process.env.TIER2_INTENT_DATABASE_URL = handle.databaseUrl;
  process.env.TIER2_INTENT_SETUP_TOKEN_FILE = handle.setupTokenFile;
  process.env.TIER2_BILLING_API_BASE_URL = handle.serverUrl;
  process.env.TIER2_BILLING_WEB_BASE_URL = handle.webUrl;
  process.env.TIER2_BILLING_DATABASE_URL = handle.databaseUrl;
  process.env.TIER2_BILLING_STRIPE_SECRET_KEY = stripe.secretKey;
  process.env.TIER2_BILLING_STRIPE_WEBHOOK_SECRET = stripe.webhookSecret;
  process.env.TIER2_BILLING_STRIPE_PRO_MONTHLY_PRICE_ID = stripe.proMonthlyPriceId;
  process.env.TIER2_BILLING_STRIPE_OVERAGE_PRICE_ID = stripe.overagePriceId;
  process.env.TIER2_BILLING_STRIPE_REFILL_PRICE_ID = stripe.refillPriceId;
  process.env.TIER2_BILLING_STRIPE_METER_ID = stripe.meterId;
  process.env.TIER2_BILLING_MODE = stripe.billingMode;
}

export async function runT2Bill1Cell(
  handle: InternalTier2WorldHandle,
  evidence: EvidenceSink,
  ledger: CleanupLedger,
): Promise<FinalCellResult> {
  return runCell(CELL, evidence, async (): Promise<CellOutcome> => {
    if (!handle.stripe) {
      // Trusted secret preflight already marked this blocked at the world
      // level (readiness observation "stripe-secret-preflight"); a strict
      // caller must never reach this cell at all (see run-vertical-slice.ts).
      // Reported here too as defense in depth: never silently invent a green.
      return {
        status: "blocked",
        detail: "Stripe test-mode credential unavailable — no sk_test_ key resolved by secret-preflight.ts",
      };
    }

    bridgeEnv(handle, handle.stripe);

    const seed = await loadSeedModule();
    const b = await loadBillingModule();

    await seed.ensureInstanceClaimed();
    const { access_token } = await seed.passwordLogin(seed.ADMIN_EMAIL, seed.ADMIN_PASSWORD);
    const me = await seed.apiRequest<{ id: string }>("/users/me", { token: access_token });
    if (me.status !== 200) {
      return { status: "failed", detail: `could not resolve admin user id (${me.status})` };
    }
    const userId = me.body.id;
    await b.ensureProductReady(userId, seed.ADMIN_EMAIL);

    const subject = await b.ensurePersonalSubject(userId);
    const clock = b.createTestClock();
    // Registered IMMEDIATELY on creation, before it is used for anything else
    // (the customer/subscription/invoice created below all live under this
    // clock) — deleting a Stripe test clock cascades to every customer and
    // related object created on it, so this one ledger entry is sufficient
    // cleanup for the whole real Stripe object graph this cell creates.
    const clockSequence = await ledger.register({
      runId: handle.run.runId,
      shardId: handle.shard.shardId,
      provider: "stripe",
      resourceType: "test-clock",
      resourceId: clock.id,
      owningWorld: "tier-2",
    });

    try {
      const email = `t2bill1-vslice-${Date.now()}@example.com`;
      const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email });
      await b.ensurePersonalSubject(userId, customer.id);

      const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
      const fullSub = b.retrieveSubscription(sub.id);
      const createdDelivery = await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
      if (createdDelivery.status !== 200) {
        return {
          status: "failed",
          detail: `customer.subscription.created webhook delivery failed (${createdDelivery.status})`,
          correlationIds: [`stripe-subscription:${sub.id}`],
        };
      }

      const invoiceId: string = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
      const invoice = b.stripeCli<Record<string, unknown>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
      const paidDelivery = await b.deliverEvent({ type: "invoice.paid", object: invoice });
      if (paidDelivery.status !== 200) {
        return {
          status: "failed",
          detail: `invoice.paid webhook delivery failed (${paidDelivery.status})`,
          correlationIds: [`stripe-invoice:${invoiceId}`],
        };
      }

      const grants = await b.listGrants(subject.id);
      const periodGrant = grants.find((g) => g.grant_type === "pro_period");
      if (!periodGrant) {
        return {
          status: "failed",
          detail: `no pro_period grant found after invoice.paid (subject has ${grants.length} grant(s): ${grants.map((g) => g.grant_type).join(", ") || "none"})`,
          correlationIds: [`stripe-subscription:${sub.id}`, `stripe-invoice:${invoiceId}`],
        };
      }
      const hours = Number(periodGrant.hours_granted);
      if (Math.abs(hours - 20) > 1) {
        return {
          status: "failed",
          detail: `pro_period grant issued but with ${hours}h, expected ~20h/seat`,
          correlationIds: [`billing-grant:${periodGrant.id}`],
        };
      }

      return {
        status: "green",
        detail: `real Stripe test-mode checkout (subscription created + invoice.paid) issued a ${hours}h pro_period grant`,
        correlationIds: [`stripe-subscription:${sub.id}`, `stripe-invoice:${invoiceId}`, `billing-grant:${periodGrant.id}`],
      };
    } finally {
      // Runs on every path (green, failed, or a thrown error) — the ledger
      // entry is never left "registered" without an attempted cleanup.
      await ledger.transition(clockSequence, "cleaning");
      try {
        // --confirm: like `subscriptions cancel`, the CLI's test-clock delete
        // is interactive by default (a DELETE confirmation prompt), which
        // hangs/fails under spawnSync with stdin ignored.
        b.stripeCli(["test_helpers", "test_clocks", "delete", clock.id, "--confirm"]);
        await ledger.transition(clockSequence, "cleaned");
      } catch (error) {
        await ledger.transition(clockSequence, "failed", describeError(error));
      }
    }
  });
}
