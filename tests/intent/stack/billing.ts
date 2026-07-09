// Tier-2 billing harness (facade): real Stripe test-mode objects + webhook
// delivery + product-code passes. DB seeding lives in billing-seed.ts and
// environment/HTTP/DB plumbing in billing-env.ts; both are re-exported so
// specs keep using a single `import * as b from "../../stack/billing.ts"`.
//
// The tier-2 rules (specs/developing/testing/README.md) hold here with one
// billing-specific reading:
//   - Stripe is REAL (test keys + test clocks). We never mock the Stripe API.
//     Subscriptions/invoices/customers are real test-mode objects created via
//     the `stripe` CLI; period boundaries ride real test clocks.
//   - Webhook delivery is self-signed with the receiver's own signing secret.
//     The event's *object* is a real Stripe object we fetched; only the
//     delivery hop is synthesized, using Stripe's real HMAC-SHA256 scheme, so
//     the server still verifies for real. Self-signing (vs. `stripe listen`)
//     lets the idempotency / replay / out-of-order / concurrent tests control
//     event ids and timing deterministically.
//   - The accounting + reconciler passes are the product's own functions the
//     15-min loop calls, run out-of-process against the booted profile DB via
//     the server venv. No product change, no test-only endpoint.

import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { REPO_ROOT } from "./boot.ts";
import {
  apiBaseUrl,
  databaseUrl,
  meterId,
  overagePriceId,
  proMonthlyPriceId,
  refillPriceId,
  stripeSecretKey,
  webhookSecret,
} from "./billing-env.ts";

export * from "./billing-env.ts";
export * from "./billing-seed.ts";

// ── Real Stripe test-mode objects (via the CLI) ──

export function stripeCli<T = any>(args: string[]): T {
  const result = spawnSync("stripe", [...args, "--api-key", stripeSecretKey()], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`stripe ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  }
  const out = result.stdout.trim();
  if (!out) {
    return undefined as T;
  }
  // Robust against any wrapper that prepends non-JSON preamble to the CLI's
  // stdout: parse from the first JSON delimiter.
  const start = out.search(/[[{]/);
  return JSON.parse(start > 0 ? out.slice(start) : out) as T;
}

export function createTestClock(frozenTime: Date = new Date()): { id: string } {
  return stripeCli(["test_helpers", "test_clocks", "create", "-d", `frozen_time=${Math.floor(frozenTime.getTime() / 1000)}`]);
}

export function advanceTestClock(clockId: string, to: Date): void {
  stripeCli(["test_helpers", "test_clocks", "advance", clockId, "-d", `frozen_time=${Math.floor(to.getTime() / 1000)}`]);
}

export function retrieveTestClock(clockId: string): { status: string } {
  return stripeCli(["test_helpers", "test_clocks", "retrieve", clockId]);
}

export interface StripeCustomer {
  id: string;
}

/** Create a real test-mode customer on a test clock, with the seeded billing
 * subject id in metadata (the key the webhook receiver resolves subjects by)
 * and a working test card attached as the default payment method. */
export function createCustomer(opts: { clockId: string; billingSubjectId: string; email: string }): StripeCustomer {
  const customer = stripeCli<StripeCustomer>([
    "customers",
    "create",
    "-d",
    `test_clock=${opts.clockId}`,
    "-d",
    `email=${opts.email}`,
    "-d",
    `metadata[billing_subject_id]=${opts.billingSubjectId}`,
  ]);
  const pm = stripeCli<{ id: string }>([
    "payment_methods",
    "attach",
    "pm_card_visa",
    "-d",
    `customer=${customer.id}`,
  ]);
  stripeCli(["customers", "update", customer.id, "-d", `invoice_settings[default_payment_method]=${pm.id}`]);
  return customer;
}

export interface StripeSubscription {
  id: string;
  status: string;
}

export function createProSubscription(opts: {
  customerId: string;
  seats: number;
  overage?: boolean;
}): StripeSubscription {
  const args = [
    "subscriptions",
    "create",
    "-d",
    `customer=${opts.customerId}`,
    "-d",
    `items[0][price]=${proMonthlyPriceId()}`,
    "-d",
    `items[0][quantity]=${opts.seats}`,
  ];
  if (opts.overage) {
    args.push("-d", `items[1][price]=${overagePriceId()}`);
  }
  return stripeCli<StripeSubscription>(args);
}

export function retrieveSubscription(subscriptionId: string): any {
  return stripeCli(["subscriptions", "retrieve", subscriptionId, "--expand", "items"]);
}

export function cancelSubscriptionAtPeriodEnd(subscriptionId: string): any {
  return stripeCli(["subscriptions", "update", subscriptionId, "-d", "cancel_at_period_end=true"]);
}

export function deleteSubscription(subscriptionId: string): any {
  return stripeCli(["subscriptions", "cancel", subscriptionId]);
}

// ── Webhook delivery (self-signed, real objects) ──

export interface DeliverResult {
  status: number;
  body: unknown;
  eventId: string;
}

/** Build a Stripe event envelope around a real object and deliver it to the
 * receiver, signed with the receiver's own secret. `eventId` is caller-chosen
 * so replay/idempotency/out-of-order tests are deterministic. */
export async function deliverEvent(opts: {
  type: string;
  object: Record<string, any>;
  eventId?: string;
  timestamp?: number;
}): Promise<DeliverResult> {
  const eventId = opts.eventId ?? `evt_test_${randomUUID().replace(/-/g, "")}`;
  const payloadObj = {
    id: eventId,
    object: "event",
    type: opts.type,
    livemode: false,
    created: opts.timestamp ?? Math.floor(Date.now() / 1000),
    data: { object: opts.object },
  };
  const payload = JSON.stringify(payloadObj);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = signPayload(payload, timestamp);
  const response = await fetch(`${apiBaseUrl()}/billing/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, eventId };
}

/** Same delivery, but two POSTs fired concurrently for the 409 in-progress
 * race. Returns both results. */
export async function deliverEventTwiceConcurrently(opts: {
  type: string;
  object: Record<string, any>;
  eventId: string;
}): Promise<[DeliverResult, DeliverResult]> {
  const payload = JSON.stringify({
    id: opts.eventId,
    object: "event",
    type: opts.type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: opts.object },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(payload, timestamp);
  const fire = async (): Promise<DeliverResult> => {
    const response = await fetch(`${apiBaseUrl()}/billing/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
      body: payload,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined, eventId: opts.eventId };
  };
  return Promise.all([fire(), fire()]) as Promise<[DeliverResult, DeliverResult]>;
}

function signPayload(payload: string, timestamp: number): string {
  // Stripe's scheme (matching stripe-python's WebhookSignature): the HMAC key
  // is the signing secret string exactly as configured (the `whsec_` prefix
  // included), over `<timestamp>.<payload>`.
  const signedPayload = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", webhookSecret()).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

// ── Product code passes, run out-of-process against the profile DB ──
//
// The real accounting/reconciler functions the 15-min loop calls, invoked
// once on demand. Same env the booted server runs with (enforce + pro billing
// + Stripe test keys), so behavior matches production, not a test stub.

function serverPass(pyExpr: string): void {
  const result = spawnSync(
    path.join(REPO_ROOT, "server", ".venv", "bin", "python"),
    ["-c", pyExpr],
    {
      cwd: path.join(REPO_ROOT, "server"),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(),
        DEBUG: "true",
        PRO_BILLING_ENABLED: "true",
        CLOUD_BILLING_MODE: process.env.TIER2_BILLING_MODE ?? "enforce",
        STRIPE_SECRET_KEY: stripeSecretKey(),
        STRIPE_WEBHOOK_SECRET: webhookSecret(),
        STRIPE_PRO_MONTHLY_PRICE_ID: proMonthlyPriceId(),
        STRIPE_CLOUD_MONTHLY_PRICE_ID: proMonthlyPriceId(),
        STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID: overagePriceId(),
        STRIPE_SANDBOX_OVERAGE_PRICE_ID: overagePriceId(),
        STRIPE_REFILL_10H_PRICE_ID: refillPriceId(),
        STRIPE_MANAGED_CLOUD_OVERAGE_METER_ID: process.env.TIER2_BILLING_STRIPE_METER_ID ?? "",
        STRIPE_SANDBOX_METER_ID: process.env.TIER2_BILLING_STRIPE_METER_ID ?? "",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`server pass failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  }
}

export function runAccountingPass(): void {
  serverPass(
    "import asyncio; from proliferate.server.billing.accounting_pass import run_billing_accounting_pass; asyncio.run(run_billing_accounting_pass(subject_limit=100))",
  );
}

export function runReconcilePass(): void {
  serverPass(
    "import asyncio; from proliferate.server.billing.reconciler import run_billing_reconcile_pass; asyncio.run(run_billing_reconcile_pass())",
  );
}

export function processSeatAdjustments(): void {
  serverPass(
    "import asyncio; from proliferate.server.billing.accounting import process_pending_seat_adjustments; asyncio.run(process_pending_seat_adjustments(limit=100))",
  );
}

export function sendPendingUsageExports(): void {
  serverPass(
    "import asyncio; from proliferate.server.billing.accounting import send_pending_usage_exports; asyncio.run(send_pending_usage_exports(limit=100))",
  );
}

export function runTopupPass(): void {
  serverPass(
    "import asyncio; from proliferate.server.cloud.agent_gateway.topups import run_llm_topups; asyncio.run(run_llm_topups())",
  );
}
