import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CheckoutCompletionUnavailableError,
  assertCheckoutUrlTestMode,
  computeGateAdmits,
  coreFunding,
  type CoreFundingTransport,
} from "./core-funding.js";
import type { BillingOverview } from "./billing-http.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

// The orchestration passes world/actor opaquely to the transport; the fakes
// need no real fields.
const world = {} as ManagedCloudWorld;
const actor = {} as AuthenticatedActor;

interface FakeConfig {
  checkout?: () => Promise<{ billingSubjectId: string }>;
  seed?: () => Promise<{ billingSubjectId: string }>;
  gate?: () => Promise<boolean> | boolean;
}

function fakeTransport(config: FakeConfig = {}): { transport: CoreFundingTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: CoreFundingTransport = {
    async runStripeCheckout() {
      calls.push("runStripeCheckout");
      return config.checkout
        ? config.checkout()
        : Promise.reject(new Error("runStripeCheckout not configured"));
    },
    async seedEntitlement() {
      calls.push("seedEntitlement");
      return config.seed ? config.seed() : { billingSubjectId: "sub_seed" };
    },
    async confirmComputeGate() {
      calls.push("confirmComputeGate");
      return config.gate ? config.gate() : true;
    },
  };
  return { transport, calls };
}

const FAST = { timeoutMs: 50, pollMs: 5 };

test("auto path prefers the real checkout and does not disclose when it succeeds", async () => {
  const { transport, calls } = fakeTransport({
    checkout: async () => ({ billingSubjectId: "sub_checkout" }),
  });
  const result = await coreFunding(world, actor, FAST, transport);
  assert.equal(result.method, "stripe_checkout");
  assert.equal(result.disclosed, false);
  assert.equal(result.billingSubjectId, "sub_checkout");
  assert.equal(result.computeGateAdmits, true);
  assert.deepEqual(calls, ["runStripeCheckout", "confirmComputeGate"]);
});

test("auto path falls back to the disclosed seed only on CheckoutCompletionUnavailableError", async () => {
  const { transport, calls } = fakeTransport({
    checkout: async () => {
      throw new CheckoutCompletionUnavailableError("impractical in the isolated world");
    },
    seed: async () => ({ billingSubjectId: "sub_seed" }),
  });
  const result = await coreFunding(world, actor, FAST, transport);
  assert.equal(result.method, "entitlement_seed");
  assert.equal(result.disclosed, true);
  assert.equal(result.billingSubjectId, "sub_seed");
  assert.deepEqual(calls, ["runStripeCheckout", "seedEntitlement", "confirmComputeGate"]);
});

test("auto path never masks a real checkout error (e.g. live-mode posture) with the seed fallback", async () => {
  const { transport, calls } = fakeTransport({
    checkout: async () => {
      throw new Error("candidate billing minted a LIVE-mode Stripe URL");
    },
  });
  await assert.rejects(() => coreFunding(world, actor, FAST, transport), /LIVE-mode/);
  assert.ok(!calls.includes("seedEntitlement"), "the seed fallback must not run on a non-impractical error");
});

test("pinning entitlement_seed skips checkout and always discloses", async () => {
  const { transport, calls } = fakeTransport({ seed: async () => ({ billingSubjectId: "sub_seed" }) });
  const result = await coreFunding(world, actor, { ...FAST, method: "entitlement_seed" }, transport);
  assert.equal(result.method, "entitlement_seed");
  assert.equal(result.disclosed, true);
  assert.ok(!calls.includes("runStripeCheckout"));
  assert.deepEqual(calls, ["seedEntitlement", "confirmComputeGate"]);
});

test("pinning stripe_checkout does NOT fall back when the checkout is impractical", async () => {
  const { transport, calls } = fakeTransport({
    checkout: async () => {
      throw new CheckoutCompletionUnavailableError("impractical");
    },
  });
  await assert.rejects(
    () => coreFunding(world, actor, { ...FAST, method: "stripe_checkout" }, transport),
    CheckoutCompletionUnavailableError,
  );
  assert.ok(!calls.includes("seedEntitlement"), "a pinned checkout must not fall back to the seed");
});

test("rejects when the compute gate never admits, after polling", async () => {
  const { transport, calls } = fakeTransport({
    checkout: async () => ({ billingSubjectId: "sub_checkout" }),
    gate: () => false,
  });
  await assert.rejects(
    () => coreFunding(world, actor, { timeoutMs: 20, pollMs: 5 }, transport),
    /did not admit provisioning/,
  );
  const gateCalls = calls.filter((c) => c === "confirmComputeGate").length;
  assert.ok(gateCalls >= 2, `expected the gate to be polled more than once, got ${gateCalls}`);
});

test("succeeds once the compute gate admits after a few polls (convergence)", async () => {
  let checks = 0;
  const { transport } = fakeTransport({
    checkout: async () => ({ billingSubjectId: "sub_checkout" }),
    gate: () => {
      checks += 1;
      return checks >= 3;
    },
  });
  const result = await coreFunding(world, actor, { timeoutMs: 200, pollMs: 5 }, transport);
  assert.equal(result.computeGateAdmits, true);
  assert.ok(checks >= 3);
});

test("assertCheckoutUrlTestMode accepts test-mode, rejects live-mode and unrecognized URLs", () => {
  assert.doesNotThrow(() => assertCheckoutUrlTestMode("https://checkout.stripe.com/c/pay/cs_test_abc"));
  assert.doesNotThrow(() =>
    assertCheckoutUrlTestMode("https://billing.stripe.com/p/session/test_abc"),
  );
  assert.throws(() => assertCheckoutUrlTestMode("https://checkout.stripe.com/c/pay/cs_live_abc"), /LIVE-mode/);
  assert.throws(() => assertCheckoutUrlTestMode("https://example.com/not-stripe"), /unrecognized URL/);
});

function overview(partial: Partial<BillingOverview>): BillingOverview {
  return {
    plan: "pro",
    billingMode: "enforce",
    remainingHours: 0,
    includedHours: 0,
    usedHours: 0,
    overQuota: false,
    isPaidCloud: false,
    paymentHealthy: false,
    overageEnabled: false,
    startBlocked: false,
    startBlockReason: null,
    activeSpendHold: false,
    holdReason: null,
    ...partial,
  };
}

test("computeGateAdmits admits an unlimited-cloud entitlement seed (remainingHours null, not paid subscription)", () => {
  // The spec-sanctioned server-side entitlement seed: unlimited hours, not a
  // Stripe subscription. isPaidCloud stays false; the gate must still admit.
  assert.equal(
    computeGateAdmits(overview({ hasUnlimitedCloudHours: true, remainingHours: null, isPaidCloud: false })),
    true,
  );
});

test("computeGateAdmits admits a positive metered balance", () => {
  assert.equal(computeGateAdmits(overview({ remainingHours: 3.5, isPaidCloud: true })), true);
});

test("computeGateAdmits rejects a start-blocked actor even with unlimited hours", () => {
  assert.equal(
    computeGateAdmits(overview({ hasUnlimitedCloudHours: true, remainingHours: null, startBlocked: true })),
    false,
  );
});

test("computeGateAdmits rejects an unfunded actor (no hours, not unlimited)", () => {
  assert.equal(computeGateAdmits(overview({ remainingHours: 0, hasUnlimitedCloudHours: false })), false);
  assert.equal(computeGateAdmits(overview({ remainingHours: null, hasUnlimitedCloudHours: false })), false);
});
