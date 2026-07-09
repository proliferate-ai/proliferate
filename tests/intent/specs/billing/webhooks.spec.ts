// T2-BILL-7 (webhook robustness: idempotency, replay, concurrency, ordering)
// and T2-BILL-8 (subscription edge states).
//
// FINDING 7 (unruled, scenarios.md T2-BILL-8): customer.subscription.deleted
// applies a payment_failed hold *unconditionally*, even after a clean
// voluntary cancellation. Confirmed in code at
// stripe_webhooks.py `_apply_payment_hold_for_subscription` (called from the
// deleted branch regardless of cancel reason). The reason-sensitive refinement
// was never shipped. We PIN the current behavior with a known-bug annotation +
// GitHub issue reference; do NOT fix product code (Pablo to rule fix-now vs
// post-release). When the fix lands this assertion inverts.

import { expect } from "@playwright/test";

import { test, adminContext, skipIfNoStripe } from "./_fixtures.ts";
import * as b from "../../stack/billing.ts";

const FINDING_7_ISSUE = "https://github.com/proliferate-ai/proliferate/issues/1032";

async function subscribedPersonalSubject() {
  const { token } = await adminContext();
  const userId = await userIdFor(token);
  const clock = b.createTestClock();
  const subject = await b.ensurePersonalSubject(userId);
  const customer = b.createCustomer({
    clockId: clock.id,
    billingSubjectId: subject.id,
    email: `t2bill7-${Date.now()}@example.com`,
  });
  await b.ensurePersonalSubject(userId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
  const fullSub = b.retrieveSubscription(sub.id);
  const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
  const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
  return { token, userId, subject, customer, sub, fullSub, invoice };
}

test.describe("T2-BILL-7: webhook robustness", () => {
  skipIfNoStripe(test);

  test("exact duplicate delivery of invoice.paid is idempotent — no double grant", async () => {
    const { subject, fullSub, invoice } = await subscribedPersonalSubject();
    await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

    const eventId = `evt_test_invpaid_${Date.now()}`;
    const first = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
    expect(first.status).toBe(200);
    const grantsAfterFirst = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;

    const second = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
    expect(second.status).toBe(200);
    const grantsAfterSecond = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;
    expect(grantsAfterSecond, "replayed invoice.paid issues no new grant").toBe(grantsAfterFirst);
  });

  test("concurrent duplicate delivery never double-processes (409 in-progress is the guard)", async () => {
    const { subject, fullSub, invoice } = await subscribedPersonalSubject();
    await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
    const before = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;

    const eventId = `evt_test_concurrent_${Date.now()}`;
    const [a, c] = await b.deliverEventTwiceConcurrently({ type: "invoice.paid", object: invoice, eventId });
    // Both are either accepted (200) or rejected in-progress (409); never a 5xx,
    // and the claim lease guarantees at most one actually processes.
    for (const r of [a, c]) {
      expect([200, 409]).toContain(r.status);
    }
    const after = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;
    expect(after - before, "concurrent duplicate issues at most one grant").toBeLessThanOrEqual(1);
  });

  test("out-of-order: invoice.paid before subscription.updated still converges", async () => {
    const { subject, fullSub, invoice } = await subscribedPersonalSubject();
    // Deliberately deliver the invoice first, subscription.updated second.
    const paid = await b.deliverEvent({ type: "invoice.paid", object: invoice });
    const updated = await b.deliverEvent({ type: "customer.subscription.updated", object: fullSub });
    expect(paid.status).toBe(200);
    expect(updated.status).toBe(200);
    // Final state converges: subscription row present + period grant issued.
    const row = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT status FROM billing_subscription
           WHERE billing_subject_id = $1 AND stripe_subscription_id = $2`,
        [subject.id, fullSub.id],
      );
      return r.rows[0];
    });
    expect(row?.status).toBe("active");
    expect((await b.listGrants(subject.id)).some((g) => g.grant_type === "pro_period")).toBe(true);
  });
});

test.describe("T2-BILL-8: subscription edge states", () => {
  skipIfNoStripe(test);

  test("payment_failed applies a hold that blocks; invoice.paid clears it", async () => {
    const { token, subject, customer, fullSub, invoice } = await subscribedPersonalSubject();
    await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

    // A failed invoice for this customer → payment_failed hold.
    const failedInvoice = { ...invoice, id: `in_test_failed_${Date.now()}`, customer: customer.id };
    await b.deliverEvent({ type: "invoice.payment_failed", object: failedInvoice });
    expect((await b.listActiveHolds(subject.id)).some((h) => h.kind === "payment_failed")).toBe(true);
    let overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
    expect(overview.body.startBlocked).toBe(true);
    expect((overview.body as any).holdReason ?? (overview.body as any).startBlockReason).toBe("payment_failed");

    // invoice.paid clears the hold.
    await b.deliverEvent({ type: "invoice.paid", object: invoice });
    expect((await b.listActiveHolds(subject.id)).some((h) => h.kind === "payment_failed")).toBe(false);
  });

  test("cancel mid-period: cancel_at_period_end synced, access continues; past the grace → cut off", async () => {
    const { token, subject, sub, fullSub } = await subscribedPersonalSubject();
    await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
    await b.seedGrant(subject.id, {
      grantType: "pro_period",
      hoursGranted: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    b.cancelSubscriptionAtPeriodEnd(sub.id);
    const cancelled = b.retrieveSubscription(sub.id);
    await b.deliverEvent({ type: "customer.subscription.updated", object: cancelled });
    const row = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT cancel_at_period_end FROM billing_subscription
           WHERE billing_subject_id = $1 AND stripe_subscription_id = $2`,
        [subject.id, sub.id],
      );
      return r.rows[0];
    });
    expect(row.cancel_at_period_end).toBe(true);
    // Access continues through period end.
    let overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
    expect(overview.body.startBlocked).toBe(false);

    // Past current_period_end + the 24h rollover grace → hard cutoff. Backdate
    // the period end well beyond the grace window.
    await b.withDb((db) =>
      db.query(
        `UPDATE billing_subscription SET current_period_end = $1 WHERE billing_subject_id = $2`,
        [new Date(Date.now() - 48 * 3600 * 1000).toISOString(), subject.id],
      ),
    );
    overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
    expect(overview.body.startBlocked, "cut off after the rollover grace elapses").toBe(true);
  });

  test(
    "FINDING 7 (pinned known-bug): subscription.deleted applies a payment_failed hold even after clean cancellation",
    async () => {
      test.info().annotations.push({
        type: "known-bug",
        description: `customer.subscription.deleted unconditionally applies payment_failed hold — UNRULED. ${FINDING_7_ISSUE}. When the reason-sensitive fix lands, invert this assertion.`,
      });
      const { subject, sub, fullSub } = await subscribedPersonalSubject();
      await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

      // Clean voluntary cancellation.
      b.cancelSubscriptionAtPeriodEnd(sub.id);
      const deleted = b.deleteSubscription(sub.id);
      await b.deliverEvent({ type: "customer.subscription.deleted", object: deleted });

      // CURRENT (buggy) behavior: a payment_failed hold is applied regardless.
      expect(
        (await b.listActiveHolds(subject.id)).some((h) => h.kind === "payment_failed"),
        "pins current unconditional payment_failed hold (finding 7)",
      ).toBe(true);
    },
  );

  test("free trial: a password-only account (no GitHub identity) gets no trial and no error", async () => {
    // Pins the current silent behavior: overview succeeds, no free_trial_v2
    // grant is lazily issued for an account with no GitHub identity (the
    // billing boot has GitHub OAuth disabled, so the admin is password-only).
    const { token } = await adminContext();
    const userId = await userIdFor(token);
    const subject = await b.ensurePersonalSubject(userId);
    const overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
    expect(overview.status).toBe(200);
    expect(
      (await b.listGrants(subject.id)).some((g) => g.grant_type === "free_trial_v2"),
      "no trial for a GitHub-less account",
    ).toBe(false);
  });

  // NOTE (contract vs. code): billing modes off/observe are a boot-env posture
  // (CLOUD_BILLING_MODE); this suite boots `enforce`, which the tests above
  // exercise. A per-mode smoke would need three boots — carried as a tier-1
  // matrix concern (test_billing_service_policy) rather than three tier-2
  // stack boots. Slack "fires once, not on replay" needs a Slack capture slot
  // not present in this harness; the idempotency the notification rides on is
  // asserted above (duplicate delivery → single process).
});

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { id: string }).id;
}
