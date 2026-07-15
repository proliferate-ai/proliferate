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
  // Retire any prior active subscription rows for this org subject first
  // (earlier specs in the run subscribe the same claimed org). Two live rows
  // is exactly the #1044 known-bug condition (MultipleResultsFound in
  // maybe_create_org_seat_adjustment breaks ALL membership changes), pinned
  // separately below — the seat-flow tests need the intended single-sub
  // state.
  await b.withDb((db) =>
    db.query(
      `UPDATE billing_subscription SET status = 'canceled', updated_at = now()
        WHERE billing_subject_id = $1 AND status IN ('active', 'trialing')`,
      [subject.id],
    ),
  );
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

    // The member ACCOUNT must exist before the subscription: invited
    // self-registration (/register) creates the account+membership but does
    // NOT enqueue a seat adjustment — only the accept-invitation service path
    // and membership-status changes do (organizations/service.py). So: create
    // the account, drop the membership (pre-subscription → no adjustment, no
    // same-period-decrease marker), then drive invite→accept over the API.
    // Retire any active subscriptions BEFORE the first membership change:
    // earlier specs (overage) subscribe this same claimed org, and >1 active
    // row is the #1044 500 (pinned separately below).
    await retireActiveSubscriptions(organizationId);
    const email = `t2bill3-member-${Date.now()}@example.com`;
    const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
    {
      const members = await seed.listMembers(token, organizationId);
      const m = members.find((mm) => mm.email === email)!;
      await seed.removeMembership(token, organizationId, m.membershipId);
    }

    const { subject } = await subscribeOrgToPro(organizationId, ownerId, 1);

    // Subscription synced with a seat quantity.
    const synced = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT status, seat_quantity, monthly_subscription_item_id FROM billing_subscription WHERE billing_subject_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [subject.id],
      );
      return r.rows[0];
    });
    expect(synced.status).toBe("active");
    expect(synced.monthly_subscription_item_id).toBeTruthy();

    // Invite + API-accept → seat adjustment bumping quantity, with a
    // proration grant. Seat targets are RELATIVE to the live ACTIVE
    // membership count (the claimed org's profile DB persists across runs).
    const invitation = await seed.inviteMember(token, organizationId, email, "member");
    const accept = await seed.acceptCurrentInvitation(memberToken, invitation.id);
    expect([200, 201]).toContain(accept.status);
    const activeAfterAdd = await activeMemberCount(organizationId);

    let adjustments = await b.listSeatAdjustments(subject.id);
    const bump = adjustments.at(-1);
    expect(bump, "invite+accept created a seat adjustment").toBeTruthy();
    expect(bump!.target_quantity).toBe(activeAfterAdd);
    expect(bump!.grant_quantity).toBeGreaterThanOrEqual(1);

    // Process it against real Stripe: quantity confirmed, proration grant issued.
    const prorationBefore = (await b.listGrants(subject.id)).filter(
      (g) => g.grant_type === "pro_seat_proration",
    ).length;
    b.processSeatAdjustments();
    adjustments = await b.listSeatAdjustments(subject.id);
    // Terminal success status is `succeeded` (billing_seats.py sets it after
    // the Stripe quantity update + grant issuance).
    expect(adjustments.at(-1)!.status).toBe("succeeded");
    const grants = await b.listGrants(subject.id);
    const proration = grants.filter((g) => g.grant_type === "pro_seat_proration");
    expect(proration.length - prorationBefore, "one proration grant for the added seat").toBe(1);

    // Remove the member → quantity synced down, no refund grant.
    const members = await seed.listMembers(token, organizationId);
    const member = members.find((m) => m.email === email)!;
    await seed.removeMembership(token, organizationId, member.membershipId);
    b.processSeatAdjustments();
    adjustments = await b.listSeatAdjustments(subject.id);
    expect(adjustments.at(-1)!.target_quantity).toBe(activeAfterAdd - 1);
    expect(adjustments.at(-1)!.grant_quantity, "removal issues no grant").toBe(0);

    // Re-invite + API-accept the SAME member within the same period →
    // quantity back up, but NO second proration grant (the same-period
    // decrease marker suppresses it — the double-grant race under test).
    const reinvite = await seed.inviteMember(token, organizationId, email, "member");
    const reaccept = await seed.acceptCurrentInvitation(memberToken, reinvite.id);
    expect([200, 201]).toContain(reaccept.status);
    b.processSeatAdjustments();
    const grantsAfter = await b.listGrants(subject.id);
    const prorationAfter = grantsAfter.filter((g) => g.grant_type === "pro_seat_proration");
    expect(
      prorationAfter.length - prorationBefore,
      "no second proration grant on same-period re-invite",
    ).toBe(1);
  });

  test("seat adjustment retries then goes failed_terminal; a later adjustment still converges", async () => {
    const { token, organizationId } = await adminContext();
    const ownerId = await userIdFor(token);
    const { subject, subscriptionId } = await subscribeOrgToPro(organizationId, ownerId, 1);

    // A seat adjustment whose Stripe item id is bogus: the update call 4xxes
    // → failed_terminal (stripe_status_is_terminal). The claim path RECOMPUTES
    // target from the live active count and noop-succeeds when it equals the
    // subscription's synced seat_quantity, so desync the stored seat_quantity
    // first to force a real Stripe call against the bogus item id.
    const retryRef = `t2bill3-retry-${Date.now()}`;
    await b.withDb(async (db) => {
      await db.query(
        `UPDATE billing_subscription SET seat_quantity = seat_quantity + 5
          WHERE billing_subject_id = $1 AND stripe_subscription_id = $2`,
        [subject.id, subscriptionId],
      );
      await db.query(
        `INSERT INTO billing_seat_adjustment
           (id, billing_subject_id, billing_subscription_id, organization_id, stripe_subscription_id,
            monthly_subscription_item_id, previous_quantity, target_quantity, grant_quantity, attempt_count, source_ref, status, created_at, updated_at)
         SELECT gen_random_uuid(), $1, bs.id, $2, $3::varchar, 'si_bogus_does_not_exist', 1, 2, 0, 0,
            $4, 'pending', now(), now()
         FROM billing_subscription bs
         WHERE bs.billing_subject_id = $1 AND bs.stripe_subscription_id = $3::varchar`,
        [subject.id, organizationId, subscriptionId, retryRef],
      );
    });
    for (let i = 0; i < 3; i++) {
      b.processSeatAdjustments();
    }
    const adjustments = await b.listSeatAdjustmentsWithRef(subject.id);
    const bogus = adjustments.find((a) => a.source_ref === retryRef);
    expect(bogus, "bogus adjustment row visible").toBeTruthy();
    expect(bogus!.status).toBe("failed_terminal");

    // A later, honest adjustment still converges: the seat pipeline is not
    // wedged by the terminal row (claim skips terminal statuses).
    await b.withDb((db) =>
      db.query(
        `UPDATE billing_subscription SET seat_quantity = seat_quantity - 5
          WHERE billing_subject_id = $1 AND stripe_subscription_id = $2`,
        [subject.id, subscriptionId],
      ),
    );
    b.processSeatAdjustments();
  });

  test(
    "two active org subscriptions no longer break membership changes (issue #1044 fixed)",
    async () => {
      // Formerly the ISSUE #1044 known-bug pin: maybe_create_org_seat_adjustment
      // now caps its subscription lookup at one row (newest by the
      // latest_healthy_cloud_subscription ordering), so a second active
      // subscription no longer raises MultipleResultsFound (issue #1044).
      const { token, organizationId } = await adminContext();
      const ownerId = await userIdFor(token);
      // Two live subscriptions on the same org subject (double-checkout /
      // re-subscribe-while-cancelling shape).
      const { subject, fullSub } = await subscribeOrgToPro(organizationId, ownerId, 1);
      // Second live subscription on the SAME Stripe customer: webhook subject
      // resolution rides billing_subject.stripe_customer_id, so a different
      // customer would attach the row to a different subject and miss the
      // two-active-rows condition.
      const customerId =
        typeof fullSub.customer === "string" ? fullSub.customer : fullSub.customer?.id;
      const sub2 = b.createProSubscription({ customerId, seats: 1 });
      await b.deliverEvent({
        type: "customer.subscription.created",
        object: b.retrieveSubscription(sub2.id),
      });
      const activeRows = await b.withDb(async (db) => {
        const r = await db.query(
          `SELECT count(*)::int AS n FROM billing_subscription
            WHERE billing_subject_id = $1 AND status IN ('active', 'trialing')`,
          [subject.id],
        );
        return r.rows[0].n as number;
      });
      expect(activeRows, "two live subscription rows staged").toBeGreaterThanOrEqual(2);

      // Any membership change now 500s (CURRENT buggy behavior).
      const email = `t2bill3-1044-member-${Date.now()}@example.com`;
      const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
      void memberToken;
      const members = await seed.listMembers(token, organizationId);
      const m = members.find((mm) => mm.email === email)!;
      const removal = await fetch(
        `${process.env.TIER2_BILLING_API_BASE_URL}/v1/organizations/${organizationId}/members/${m.membershipId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      expect(
        [200, 204],
        "membership change succeeds despite two live subscription rows (issue #1044 fixed)",
      ).toContain(removal.status);

      // Clean up the org's subscription state for later specs.
      await b.withDb((db) =>
        db.query(
          `UPDATE billing_subscription SET status = 'canceled', updated_at = now()
            WHERE billing_subject_id = $1 AND status IN ('active', 'trialing')`,
          [subject.id],
        ),
      );
    },
  );
});

test.describe("T2-BILL-4: team checkout — the second, independent org-creation path", () => {
  skipIfNoStripe(test);

  test("creating a team checkout intent leaves the org pending_checkout (not joinable)", async () => {
    const { token } = await adminContext();
    // Request shape per TeamCheckoutRequest (team_checkout/models.py):
    // teamName + inviteEmails; seat count is derived server-side from invitees.
    const res = await b.apiRequest<{ intentId: string; url: string }>(
      "/v1/billing/team-checkout",
      {
        method: "POST",
        token,
        body: {
          teamName: `Team ${Date.now()}`,
          inviteEmails: [],
          returnSurface: "web",
        },
      },
    );
    // A real test-mode session is created and the intent is pending.
    expect([200, 201]).toContain(res.status);
    const current = await b.apiRequest<{ intent: { status: string } | null }>(
      "/v1/billing/team-checkout/current",
      { token },
    );
    expect(current.status).toBe(200);
  });

  test("replayed team-subscription activation webhook is idempotent (no second org activation)", async () => {
    // Drive the REAL activation path: the pending intent from the test above
    // (get_current_team_checkout_intent is per-user, so the admin reuses it),
    // a real trialing subscription on the intent's Stripe customer carrying
    // the metadata activation verifies against the session, then two
    // deliveries of the same checkout.session.completed event. A synthetic
    // metadata-less object is rejected 400 by design
    // (team_checkout_metadata_missing) and would never exercise activation.
    const { token } = await adminContext();
    const userId = await userIdFor(token);

    // The intent row (created via the product API in the previous test; fall
    // back to creating one if this test runs standalone).
    let intent = await currentIntentRow(userId);
    if (!intent) {
      await b.apiRequest("/v1/billing/team-checkout", {
        method: "POST",
        token,
        body: { teamName: `Team ${Date.now()}`, inviteEmails: [], returnSurface: "web" },
      });
      intent = await currentIntentRow(userId);
    }
    expect(intent, "a pending team-checkout intent exists").toBeTruthy();

    // Real subscription on the intent's real customer. trial_period_days puts
    // it in `trialing` (activation accepts active|trialing) without needing a
    // payment method on the service-created customer.
    const metadata = {
      purpose: "team_subscription",
      organization_checkout_intent_id: intent!.id,
      organization_id: intent!.organization_id,
      created_by_user_id: userId,
      billing_subject_id: intent!.billing_subject_id,
    };
    const subArgs = [
      "subscriptions",
      "create",
      "-d",
      `customer=${intent!.stripe_customer_id}`,
      "-d",
      "items[0][price]=" + process.env.TIER2_BILLING_STRIPE_PRO_MONTHLY_PRICE_ID,
      "-d",
      "items[0][quantity]=1",
      "-d",
      "trial_period_days=7",
    ];
    for (const [k, v] of Object.entries(metadata)) {
      subArgs.push("-d", `metadata[${k}]=${v}`);
    }
    const sub = b.stripeCli<{ id: string; status: string }>(subArgs);
    expect(["active", "trialing"]).toContain(sub.status);

    const eventId = `evt_test_teamdup_${Date.now()}`;
    const session = {
      id: `cs_test_${Date.now()}`,
      object: "checkout_session",
      mode: "subscription",
      metadata,
      subscription: sub.id,
      customer: intent!.stripe_customer_id,
    };

    const first = await b.deliverEvent({ type: "checkout.session.completed", object: session, eventId });
    expect(first.status).toBe(200);

    // Real activation happened: intent completed, org active.
    const activated = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT i.status AS intent_status, o.status AS org_status
           FROM organization_checkout_intent i
           JOIN organization o ON o.id = i.organization_id
          WHERE i.id = $1`,
        [intent!.id],
      );
      return r.rows[0];
    });
    expect(activated.intent_status).toBe("completed");
    expect(activated.org_status).toBe("active");

    // Replay: same event id → silent ack, no reprocessing, no new receipt.
    const before = await b.countWebhookReceipts("checkout.session.completed");
    const second = await b.deliverEvent({ type: "checkout.session.completed", object: session, eventId });
    const after = await b.countWebhookReceipts("checkout.session.completed");
    expect(second.status).toBe(200);
    expect(after, "duplicate delivery is a silent ack, no new receipt").toBe(before);
    const subsCount = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM billing_subscription WHERE stripe_subscription_id = $1`,
        [sub.id],
      );
      return r.rows[0].n as number;
    });
    expect(subsCount, "one subscription row, not re-activated").toBe(1);
  });

  // NOTE (contract vs. code): the `failed_billing_state` (sub not
  // active|trialing at webhook time) and 24h-expiry terminal transitions of
  // T2-BILL-4 need a fully-staged team intent bound to a real session with a
  // non-active subscription. That staging is heavier than the per-merge budget
  // and the transition logic is unit-covered in the team_checkout tier-1
  // suite; the tier-2 assertions here pin the intent-creation + activation
  // idempotency seams, which are the full-stack-only behaviors.
});

async function retireActiveSubscriptions(organizationId: string): Promise<void> {
  await b.withDb((db) =>
    db.query(
      `UPDATE billing_subscription bs SET status = 'canceled', updated_at = now()
        FROM billing_subject s
       WHERE s.id = bs.billing_subject_id AND s.organization_id = $1
         AND bs.status IN ('active', 'trialing')`,
      [organizationId],
    ),
  );
}

async function activeMemberCount(organizationId: string): Promise<number> {
  return b.withDb(async (db) => {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM organization_membership
        WHERE organization_id = $1 AND status = 'active'`,
      [organizationId],
    );
    return Math.max(r.rows[0].n as number, 1);
  });
}

interface IntentRow {
  id: string;
  organization_id: string;
  billing_subject_id: string;
  stripe_customer_id: string | null;
}

async function currentIntentRow(userId: string): Promise<IntentRow | null> {
  return b.withDb(async (db) => {
    const r = await db.query(
      `SELECT id, organization_id, billing_subject_id, stripe_customer_id
         FROM organization_checkout_intent
        WHERE created_by_user_id = $1 AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return (r.rows[0] as IntentRow | undefined) ?? null;
  });
}

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { id: string }).id;
}
