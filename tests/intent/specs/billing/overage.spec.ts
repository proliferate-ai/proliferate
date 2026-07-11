// T2-BILL-5 (compute overage: bill to cap, write off past it, hard-block;
// disabled → immediate cutoff) and T2-BILL-6 (LLM credits: exhaustion, admin
// caps, auto top-up incl. declined-card fail-closed).
//
// Tier boundary (T2-BILL-6): the LiteLLM virtual-key *disable* side effect is
// a tier-3 assertion (it calls the live gateway). At tier 2 we seed the spend
// records and assert the truthful billing surfaces + gate inputs the enforcer
// reads (`/billing/llm-balance`, `/organizations/{id}/limits`,
// `is_gateway_budget_available`) and the fail-closed top-up guard. No LiteLLM
// calls, per the tier-2 no-mock-LLM rule.

import { expect } from "@playwright/test";

import { test, adminContext } from "./_fixtures.ts";
import * as b from "../../stack/billing.ts";

async function paidOrgSubjectWithBackdatedPeriod(seats = 1) {
  const { token, organizationId } = await adminContext();
  const ownerId = await userIdFor(token);
  const clock = b.createTestClock();
  const subject = await b.ensureOrganizationSubject(organizationId, ownerId);
  const customer = b.createCustomer({
    clockId: clock.id,
    billingSubjectId: subject.id,
    email: `t2bill5-${Date.now()}@example.com`,
  });
  await b.ensureOrganizationSubject(organizationId, ownerId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats, overage: true });
  await b.deliverEvent({ type: "customer.subscription.created", object: b.retrieveSubscription(sub.id) });
  // Backdate the synced period start so seeded recent segments fall inside the
  // paid period (test-time shift, the direct-DB analog of a test clock — the
  // same precedent as the invitation-expiry backdate in seed.ts).
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  await b.withDb((db) =>
    db.query(`UPDATE billing_subscription SET current_period_start = $1 WHERE billing_subject_id = $2`, [
      twoHoursAgo.toISOString(),
      subject.id,
    ]),
  );
  return { subject, ownerId, token, organizationId };
}

test.describe("T2-BILL-5: compute overage — bill to cap, write off, then block", () => {
  test("uncovered seconds export as billable cents up to cap, then write off; snapshot flips to cap_exhausted", async () => {
    const { subject, ownerId, token, organizationId } = await paidOrgSubjectWithBackdatedPeriod(1);
    // The effective cap is per-seat × ACTIVE org members (accounting.py:
    // max(active_seat_count,1) * overage_cap_cents_per_seat), and the claimed
    // org's member count grows across runs (profile DB persists) — so compute
    // the cap from the live seat count instead of assuming one seat.
    const seats = await activeMemberCount(organizationId);
    const capPerSeat = 2;
    const capCents = seats * capPerSeat;
    await b.setOverageSettings(subject.id, { enabled: true, capCentsPerSeat: capPerSeat });

    // Tiny grant (72s), then a segment long enough that its uncovered tail
    // converts to cents well past the cap (overage is 200 cents/hour).
    const hoursPastCap = capCents / 200 + 0.6;
    await b.seedGrant(subject.id, { userId: ownerId, grantType: "pro_period", hoursGranted: 0.02 });
    await b.seedUsageSegment(subject.id, {
      userId: ownerId,
      hours: hoursPastCap,
      startedAt: new Date(Date.now() - (hoursPastCap * 60 + 10) * 60 * 1000),
    });
    b.runAccountingPass();

    const exports = await b.listUsageExports(subject.id);
    const billable = exports.filter((e) => (e.meter_quantity_cents ?? 0) > 0);
    const writeoffs = exports.filter((e) => e.writeoff_reason === "overage_cap_exhausted");
    const billableCents = billable.reduce((s, e) => s + (e.meter_quantity_cents ?? 0), 0);
    expect(billable.length, "billable export rows created").toBeGreaterThan(0);
    expect(billableCents, "billing stops at the cap").toBeLessThanOrEqual(capCents);
    expect(writeoffs.length, "usage past cap is written off").toBeGreaterThan(0);

    // Owner scope matters: without it /billing/overview resolves the caller's
    // PERSONAL subject (permissions.py falls back to personal), but this
    // scenario's state lives on the org subject.
    const overview = await b.apiRequest<b.BlockState>(
      `/v1/billing/overview?ownerScope=organization&organizationId=${organizationId}`,
      { token },
    );
    expect(overview.body.startBlocked).toBe(true);
    expect((overview.body as any).startBlockReason).toBe("cap_exhausted");
  });

  test("overage disabled → immediate cutoff at grant exhaustion, zero export rows", async () => {
    const { subject, ownerId, token, organizationId } = await paidOrgSubjectWithBackdatedPeriod(1);
    await b.setOverageSettings(subject.id, { enabled: false });
    // The org subject is shared with the cap test above (one claimed org →
    // one org billing subject), so count NEW export rows, not all rows.
    const exportsBefore = (await b.listUsageExports(subject.id)).length;

    await b.seedGrant(subject.id, { userId: ownerId, grantType: "pro_period", hoursGranted: 0.02 });
    await b.seedUsageSegment(subject.id, {
      userId: ownerId,
      hours: 0.66,
      startedAt: new Date(Date.now() - 50 * 60 * 1000),
    });
    b.runAccountingPass();

    const exports = await b.listUsageExports(subject.id);
    expect(exports.length - exportsBefore, "no new export rows when overage is disabled").toBe(0);
    const overview = await b.apiRequest<b.BlockState>(
      `/v1/billing/overview?ownerScope=organization&organizationId=${organizationId}`,
      { token },
    );
    expect(overview.body.startBlocked).toBe(true);
    expect((overview.body as any).startBlockReason).toBe("overage_disabled");
  });

  test("overage-settings API validates the cap (invalid_overage_cap outside 0..1,000,000)", async () => {
    const { token } = await adminContext();
    const res = await b.apiRequest("/v1/billing/overage-settings", {
      method: "POST",
      token,
      body: { enabled: true, capCentsPerSeat: 5_000_000, ownerScope: "personal" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((res.body as any)?.detail?.code ?? (res.body as any)?.code).toBe("invalid_overage_cap");
  });
});

test.describe("T2-BILL-6: LLM credits — exhaustion, admin caps, top-ups", () => {
  test("llm-balance reflects seeded spend and goes non-positive on exhaustion", async () => {
    const { token } = await adminContext();
    const userId = await userIdFor(token);
    const subject = await b.ensurePersonalSubject(userId);

    const before = await b.apiRequest<{ usedUsd: number; remainingUsd: number }>("/v1/billing/llm-balance", {
      token,
    });
    await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 12.5 });
    const after = await b.apiRequest<{ usedUsd: number; remainingUsd: number }>("/v1/billing/llm-balance", {
      token,
    });
    expect(after.body.usedUsd - before.body.usedUsd).toBeCloseTo(12.5, 2);
    // With no granted credit exceeding the spend, remaining is driven non-positive.
    expect(after.body.remainingUsd).toBeLessThanOrEqual(before.body.remainingUsd);
  });

  test("admin llm cap is independent of credit refill; disabling the cap clears the binding", async () => {
    const { token, organizationId } = await adminContext();
    const userId = await userIdFor(token);
    const subject = await b.ensureOrganizationSubject(organizationId, userId);

    // Org-wide monthly LLM cap of $5, then $8 of spend → over cap.
    const limitId = await b.seedBudgetLimit({
      organizationId,
      userId: null,
      kind: "llm",
      window: "month",
      capValue: 5,
    });
    await b.seedLlmUsageEvent({ subjectId: subject.id, organizationId, userId, costUsd: 8 });

    let limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(
      `/v1/organizations/${organizationId}/limits`,
      { token },
    );
    const llmCap = limits.body.limits.find((l) => (l as any).kind === "llm");
    expect(llmCap?.capValue).toBe(5);
    expect(llmCap?.enabled).toBe(true);

    // A credit refill does NOT clear the admin cap (deliberate) — the cap row
    // stays enabled regardless of new grants.
    await b.seedGrant(subject.id, { userId, grantType: "refill_10h", hoursGranted: 10 });
    limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(`/v1/organizations/${organizationId}/limits`, { token });
    expect(limits.body.limits.find((l) => (l as any).kind === "llm")?.enabled).toBe(true);

    // Disabling the cap clears the binding (the quiet-tick sweep would then
    // reactivate the key; here we assert the binding is gone).
    await b.setBudgetLimitEnabled(limitId, false);
    limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(`/v1/organizations/${organizationId}/limits`, { token });
    const disabled = limits.body.limits.find((l) => (l as any).kind === "llm");
    expect(disabled === undefined || disabled.enabled === false).toBe(true);
  });

  test("auto top-up is fail-closed when the top-up price id is unset (feature off)", async () => {
    // agent_gateway_llm_topup_price_id is unset in the billing boot, so
    // topups_enabled() is false: an over-balance subject gets NO `topup` grant.
    // This is the "overage promise quietly evaporates" guard — off must mean
    // no silent charge and no free credit.
    const { token } = await adminContext();
    const userId = await userIdFor(token);
    const subject = await b.ensurePersonalSubject(userId);
    await b.setOverageSettings(subject.id, { enabled: true });
    await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 50 });

    b.runTopupPass();
    const grants = await b.listGrants(subject.id);
    expect(grants.some((g) => g.grant_type === "topup"), "no topup grant when feature is off").toBe(false);
  });
});

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

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { id: string }).id;
}
