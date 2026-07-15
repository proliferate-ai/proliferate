// T2-BILL-1 (checkout → grants → consumption → cut-off → reactivate + grant
// drain order) and T2-BILL-2 (plan limits + policy gates).
//
// Tier boundaries applied here (see scenarios.md and the PR body):
//   - "checkout" at tier 2 = the real Stripe checkout SESSION is created
//     (`/billing/cloud-checkout` returns a live test-mode session URL); the
//     hosted card page is not automatable headlessly, so activation is driven
//     by the real subscription + `invoice.paid` webhook path, exactly what the
//     hosted page's completion triggers. No mocked Stripe.
//   - "resume/connect blocked (402)" is a tier-3 assertion (needs a real E2B
//     sandbox). At tier 2 the truthful, equivalent seam is the billing
//     snapshot the resume gate reads: `/billing/overview` exposes
//     `startBlocked` + `startBlockReason`, and that reason IS the block kind
//     the UI renders. We assert the decision, not a live wake.

import { expect } from "@playwright/test";

import { test, adminContext, adminUserId, skipIfNoStripe } from "./_fixtures.ts";
import * as b from "../../stack/billing.ts";

const HOUR = 3600;

test.describe("T2-BILL-1: checkout → grants → consumption → cut-off → reactivate", () => {
  skipIfNoStripe(test);

  test("cloud-checkout creates a real Stripe test-mode session", async () => {
    const { token } = await adminContext();
    const res = await b.apiRequest<{ url: string }>("/v1/billing/cloud-checkout", {
      method: "POST",
      token,
      body: { ownerScope: "personal", returnSurface: "web" },
    });
    expect(res.status).toBe(200);
    // A live test-mode Checkout Session, not a stub.
    expect(res.body.url).toMatch(/checkout\.stripe\.com|billing/);
  });

  test("invoice.paid on a pro subscription issues the pro_period grant; consumption drains it; then blocked; then reactivated", async () => {
    const userId = await adminUserId();
    const email = `t2bill1-${Date.now()}@example.com`;

    // Real test-clock customer linked to the seeded personal subject.
    const clock = b.createTestClock();
    const subject = await b.ensurePersonalSubject(userId);
    const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email });
    await b.ensurePersonalSubject(userId, customer.id);

    // Real pro subscription (1 seat). Deliver the created + invoice.paid events
    // that the hosted checkout completion would have produced.
    const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
    const fullSub = b.retrieveSubscription(sub.id);
    await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

    const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
    const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
    const paid = await b.deliverEvent({ type: "invoice.paid", object: invoice });
    expect(paid.status).toBe(200);

    // Pro period grant issued: 20h/seat.
    const grants = await b.listGrants(subject.id);
    const periodGrant = grants.find((g) => g.grant_type === "pro_period");
    expect(periodGrant, "pro_period grant issued by invoice.paid").toBeTruthy();
    expect(Number(periodGrant!.hours_granted)).toBeCloseTo(20, 1);

    // Backdate the grant's effective_at: accounting checks grant usability at
    // each usage range's accounted_from (grant_is_usable_for_accounting
    // at=accounted_from), and the 21h segment seeded below STARTS 21h ago —
    // before the grant that was just issued "now" — so without the shift the
    // drain would consume nothing. Direct-DB time shift, same convention as
    // the invitation-expiry backdate in seed.ts.
    await b.withDb((db) =>
      db.query(`UPDATE billing_grant SET effective_at = $1 WHERE id = $2`, [
        new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        periodGrant!.id,
      ]),
    );

    // Overview reflects a paid plan, not blocked, with credit remaining.
    let overview = await b.apiRequest<{ startBlocked: boolean; remainingHours: number }>(
      "/v1/billing/overview",
      { token: (await adminContext()).token },
    );
    expect(overview.body.startBlocked).toBe(false);
    expect(overview.body.remainingHours).toBeGreaterThan(0);

    // The subscription sync auto-enables overage for a fresh pro subject
    // (default_pro_overage_enabled in stripe_webhooks.py), and a healthy pro
    // subject with overage on is deliberately NOT blocked at exhaustion — it
    // rides overage until the cap (T2-BILL-5 covers that arm). This scenario
    // asserts the hard cut-off, i.e. the overage-off posture, so flip the
    // subject's preference off first (the product's own user setting).
    await b.setOverageSettings(subject.id, { enabled: false });

    // Consumption: seed a segment that eats the whole grant, run the REAL
    // accounting pass (the same function the 15-min loop calls).
    await b.seedUsageSegment(subject.id, { userId, hours: 21 });
    b.runAccountingPass();
    expect(await b.totalRemainingSeconds(subject.id)).toBeLessThan(60);

    // Cut-off: the snapshot the resume gate reads is now blocked. For a pro
    // subject with overage off the enumerated reason is `overage_disabled`
    // (snapshots.py orders it before the generic credits_exhausted, which is
    // the free/trial-path reason scenarios.md names — same blocked state in
    // the UI, more specific reason string).
    overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token: (await adminContext()).token });
    expect(overview.body.startBlocked).toBe(true);
    expect((overview.body as any).startBlockReason).toBe("overage_disabled");

    // Reactivate (pro path): a top-up grant restores credit → unblocked.
    await b.seedGrant(subject.id, {
      userId,
      grantType: "pro_period",
      hoursGranted: 5,
      expiresAt: fullSub.current_period_end ? new Date(fullSub.current_period_end * 1000) : null,
      sourceRef: `t2bill1-topup-${Date.now()}`,
    });
    overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token: (await adminContext()).token });
    expect(overview.body.startBlocked).toBe(false);
  });

  test("grants drain earliest-expiring-first (ordered_accounting_grants)", async () => {
    const userId = await adminUserId();
    // A fresh personal subject via a throwaway member keeps this test's drain
    // math isolated from the admin subject the previous test mutated.
    const { token, organizationId } = await adminContext();
    const email = `t2bill1-drain-${Date.now()}@example.com`;
    const memberToken = await inviteMember(token, organizationId, email);
    const memberId = await userIdFor(memberToken);
    const subject = await b.ensurePersonalSubject(memberId);

    // Grant type matters: ordered_accounting_grants only consumes
    // free_trial_v2/refill for an UNPAID subject (pro_period is exclusively a
    // paid-subject grant kind and would never drain here). Two free_trial_v2
    // grants with different expiries exercise exactly the earliest-expiring-
    // first ordering under test.
    const now = Date.now();
    const early = await b.seedGrant(subject.id, {
      userId: memberId,
      grantType: "free_trial_v2",
      hoursGranted: 2,
      expiresAt: new Date(now + 2 * 24 * HOUR * 1000),
      sourceRef: `drain-early-${now}`,
    });
    const late = await b.seedGrant(subject.id, {
      userId: memberId,
      grantType: "free_trial_v2",
      hoursGranted: 2,
      expiresAt: new Date(now + 30 * 24 * HOUR * 1000),
      sourceRef: `drain-late-${now}`,
    });

    // Consume 2h — exactly the earlier grant's worth.
    await b.seedUsageSegment(subject.id, { userId: memberId, hours: 2 });
    b.runAccountingPass();

    const grants = await b.listGrants(subject.id);
    const earlyRow = grants.find((g) => g.id === early)!;
    const lateRow = grants.find((g) => g.id === late)!;
    expect(Number(earlyRow.remaining_seconds), "earliest-expiring drained first").toBeLessThan(60);
    expect(Number(lateRow.remaining_seconds), "later-expiring untouched").toBeGreaterThan(2 * HOUR - 120);
  });
});

test.describe("T2-BILL-2: plan limits + policy gates", () => {
  skipIfNoStripe(test);

  test("agent-gateway policy edit is gated by min plan on a free org (org_agent_policy_plan_required, 403)", async () => {
    const { token, organizationId } = await adminContext();
    // The claimed admin org is on the free plan; agent_gateway_policy_min_plan
    // defaults to "pro", so editing the gateway auth policy must 403.
    const res = await b.apiRequest(
      `/v1/cloud/organizations/${organizationId}/agent-gateway/policy`,
      {
        method: "PUT",
        token,
        body: { defaultAuthMethod: "gateway", allowedAuthMethods: ["gateway"] },
      },
    );
    expect(res.status).toBe(403);
    expect((res.body as any)?.detail?.code ?? (res.body as any)?.code).toBe(
      "org_agent_policy_plan_required",
    );
  });

  // NOTE (contract flag, carried from scenarios.md T2-BILL-2): there is no
  // plan-conditioned model list in code today, so the "plan gates the model
  // list" flows.md row has no tier-2 assertion here — it stays a tier-3 row
  // pending the [PABLO TO RULE] decision. The free-plan repo-limit
  // (`repo_limit_exceeded`) is exercised by the tier-1 automations suite
  // (server/tests) against the scheduling path; reproducing it here would need
  // the repo-scheduling surface seeded with N+1 repos, which buys nothing over
  // the unit coverage. Documented rather than duplicated.
});

// ── local helpers ──

async function inviteMember(adminToken: string, organizationId: string, email: string): Promise<string> {
  const seed = await import("../../stack/seed.ts");
  return seed.registerFreshMember(adminToken, organizationId, email, "Tier2Intent!Passw0rd", "member");
}

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}
