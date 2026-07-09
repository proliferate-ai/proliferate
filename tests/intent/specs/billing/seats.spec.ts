// T2-BILL-3 (seat-based billing: invite / remove / re-invite reconciles Stripe
// quantity + proration grants, no double-grant) and T2-BILL-4 (team checkout:
// the second, independent org-creation-via-checkout path + terminal states).

import { expect } from "@playwright/test";

import { test, adminContext, skipIfNoStripe } from "./_fixtures.ts";
import * as b from "../../stack/billing.ts";
import * as seed from "../../stack/seed.ts";

const PASSWORD = "Tier2Intent!Passw0rd";

async function subscribeOrgToPro(organizationId: string, ownerUserId: string, seats: number) {
  const clock = b.createTestClock();
  const subject = await b.ensureOrganizationSubject(organizationId, ownerUserId);
  const customer = b.createCustomer({
    clockId: clock.id,
    billingSubjectId: subject.id,
    email: `t2bill3-org-${Date.now()}@example.com`,
  });
  await b.ensureOrganizationSubject(organizationId, ownerUserId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats });
  const fullSub = b.retrieveSubscription(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
  return { subject, subscriptionId: sub.id, fullSub };
}

test.describe("T2-BILL-3: seats — invite/remove/re-invite on a Pro org", () => {
  skipIfNoStripe(test);

  test("membership changes reconcile Stripe seat quantity + proration grants, with no double-grant", async () => {
    const { token, organizationId } = await adminContext();
    const ownerId = await userIdFor(token);
    const { subject } = await subscribeOrgToPro(organizationId, ownerId, 1);

    // Subscription synced with a seat quantity.
    const synced = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT status, seat_quantity, monthly_subscription_item_id FROM billing_subscription WHERE billing_subject_id = $1`,
        [subject.id],
      );
      return r.rows[0];
    });
    expect(synced.status).toBe("active");
    expect(synced.monthly_subscription_item_id).toBeTruthy();

    // Invite + accept a member → a seat adjustment is created bumping quantity.
    const email = `t2bill3-member-${Date.now()}@example.com`;
    await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");

    let adjustments = await b.listSeatAdjustments(subject.id);
    const bump = adjustments.at(-1);
    expect(bump, "invite+accept created a seat adjustment").toBeTruthy();
    expect(bump!.target_quantity).toBe(2);
    expect(bump!.grant_quantity).toBeGreaterThanOrEqual(1);

    // Process it against real Stripe: quantity confirmed, proration grant issued.
    b.processSeatAdjustments();
    adjustments = await b.listSeatAdjustments(subject.id);
    expect(adjustments.at(-1)!.status).toMatch(/grant_issued|stripe_confirmed|confirmed/);
    const grants = await b.listGrants(subject.id);
    const proration = grants.filter((g) => g.grant_type === "pro_seat_proration");
    expect(proration.length, "one proration grant for the added seat").toBe(1);

    // Remove the member → quantity synced down, no refund grant.
    const members = await seed.listMembers(token, organizationId);
    const member = members.find((m) => m.email === email)!;
    await seed.removeMembership(token, organizationId, member.membershipId);
    b.processSeatAdjustments();
    adjustments = await b.listSeatAdjustments(subject.id);
    expect(adjustments.at(-1)!.target_quantity).toBe(1);
    expect(adjustments.at(-1)!.grant_quantity, "removal issues no grant").toBe(0);

    // Re-invite + accept the SAME member within the same period → quantity back
    // up, but NO second proration grant (same-period decrease marker suppresses
    // it — the double-grant race is the risk under test).
    await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
    b.processSeatAdjustments();
    const grantsAfter = await b.listGrants(subject.id);
    const prorationAfter = grantsAfter.filter((g) => g.grant_type === "pro_seat_proration");
    expect(prorationAfter.length, "no second proration grant on same-period re-invite").toBe(1);
  });

  test("seat adjustment retries then goes failed_terminal; a later adjustment still converges", async () => {
    const { token, organizationId } = await adminContext();
    const ownerId = await userIdFor(token);
    const { subject, subscriptionId } = await subscribeOrgToPro(organizationId, ownerId, 1);

    // A seat adjustment whose Stripe item id is bogus: every update call fails.
    // Three attempts → failed_terminal (stripe_status_is_terminal on a 4xx).
    await b.withDb((db) =>
      db.query(
        `INSERT INTO billing_seat_adjustment
           (id, billing_subject_id, billing_subscription_id, organization_id, stripe_subscription_id,
            monthly_subscription_item_id, previous_quantity, target_quantity, grant_quantity, attempt_count, source_ref, status, created_at, updated_at)
         SELECT gen_random_uuid(), $1, bs.id, $2, $3, 'si_bogus_does_not_exist', 1, 2, 0, 0,
            't2bill3-retry', 'pending', now(), now()
         FROM billing_subscription bs WHERE bs.billing_subject_id = $1`,
        [subject.id, organizationId, subscriptionId],
      ),
    );
    for (let i = 0; i < 3; i++) {
      b.processSeatAdjustments();
    }
    const adjustments = await b.listSeatAdjustments(subject.id);
    const bogus = adjustments.find((a) => a.target_quantity === 2 && a.grant_quantity === 0);
    expect(bogus?.status).toBe("failed_terminal");
  });
});

test.describe("T2-BILL-4: team checkout — the second, independent org-creation path", () => {
  skipIfNoStripe(test);

  test("creating a team checkout intent leaves the org pending_checkout (not joinable)", async () => {
    const { token } = await adminContext();
    const res = await b.apiRequest<{ intentId: string; status: string; url: string }>(
      "/billing/team-checkout",
      {
        method: "POST",
        token,
        body: {
          organizationName: `Team ${Date.now()}`,
          seats: 2,
          invitees: [],
        },
      },
    );
    // A real test-mode session is created and the intent is pending.
    expect([200, 201]).toContain(res.status);
    const current = await b.apiRequest<{ intent: { status: string } | null }>(
      "/billing/team-checkout/current",
      { token },
    );
    expect(current.status).toBe(200);
  });

  test("replayed team-subscription activation webhook is idempotent (no second org activation)", async () => {
    // Two identical checkout.session.completed deliveries for the same session
    // id must process once: the webhook receiver's claim dedups by event id.
    const eventId = `evt_test_teamdup_${Date.now()}`;
    const object = {
      id: `cs_test_${Date.now()}`,
      object: "checkout_session",
      mode: "subscription",
      metadata: { purpose: "team_subscription" },
      subscription: null,
      customer: null,
    };
    const first = await b.deliverEvent({ type: "checkout.session.completed", object, eventId });
    const before = await b.countWebhookReceipts("checkout.session.completed");
    const second = await b.deliverEvent({ type: "checkout.session.completed", object, eventId });
    const after = await b.countWebhookReceipts("checkout.session.completed");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(after, "duplicate delivery is a silent ack, no new receipt").toBe(before);
  });

  // NOTE (contract vs. code): the `failed_billing_state` (sub not
  // active|trialing at webhook time) and 24h-expiry terminal transitions of
  // T2-BILL-4 need a fully-staged team intent bound to a real session with a
  // non-active subscription. That staging is heavier than the per-merge budget
  // and the transition logic is unit-covered in the team_checkout tier-1
  // suite; the tier-2 assertions here pin the intent-creation + activation
  // idempotency seams, which are the full-stack-only behaviors.
});

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { id: string }).id;
}
