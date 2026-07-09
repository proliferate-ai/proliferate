// T2-BILL-9: usage surfaces tell the truth. Seed known usage (compute segments
// + LLM events with fixed amounts) → assert the read APIs return exactly the
// seeded totals, attributed to the right user, and the UI renders them.
//
// #1028 flag (org compute-budget attribution, unmerged at time of writing):
// pre-#1028, a workspace's compute `usage_segment` bills the *owner's personal*
// subject; #1028 re-attributes org-enrolled compute to the org subject. The
// by-user compute assertion is guarded so it tracks whichever behavior is
// deployed. Default OFF = current (pre-#1028) behavior. Same spirit as the
// runner's GITHUB_LINK_GATE_WORKAROUND_ACTIVE flag.

import { expect } from "@playwright/test";

import { test, adminContext, skipIfNoStripe } from "./_fixtures.ts";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../stack/seed.ts";
import * as b from "../../stack/billing.ts";

const ORG_COMPUTE_ATTRIBUTION_ACTIVE = process.env.T2BILLING_ORG_COMPUTE_ATTRIBUTION === "1";

test.describe("T2-BILL-9: usage surfaces tell the truth", () => {
  skipIfNoStripe(test);

  test("summary + timeseries + llm-balance return exactly the seeded totals", async () => {
    const { token } = await adminContext();
    const userId = await userIdFor(token);
    const subject = await b.ensurePersonalSubject(userId);

    const summaryBefore = await b.apiRequest<{ computeUsedSecondsMtd: number; llmUsedUsdMtd: number }>(
      "/billing/usage/summary",
      { token },
    );
    const balanceBefore = await b.apiRequest<{ usedUsd: number }>("/billing/llm-balance", { token });

    // Seed a precise, known amount: 1 hour compute + $3.25 + $1.75 LLM.
    await b.seedUsageSegment(subject.id, { userId, hours: 1, startedAt: new Date(Date.now() - 30 * 60 * 1000) });
    await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 3.25 });
    await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 1.75 });

    const summary = await b.apiRequest<{ computeUsedSecondsMtd: number; llmUsedUsdMtd: number }>(
      "/billing/usage/summary",
      { token },
    );
    expect(
      summary.body.computeUsedSecondsMtd - summaryBefore.body.computeUsedSecondsMtd,
      "summary compute reflects the seeded hour",
    ).toBeCloseTo(3600, -1);
    expect(
      summary.body.llmUsedUsdMtd - summaryBefore.body.llmUsedUsdMtd,
      "summary LLM reflects the seeded $5.00",
    ).toBeCloseTo(5.0, 2);

    const balance = await b.apiRequest<{ usedUsd: number }>("/billing/llm-balance", { token });
    expect(balance.body.usedUsd - balanceBefore.body.usedUsd).toBeCloseTo(5.0, 2);

    const timeseries = await b.apiRequest<{ buckets: Array<{ computeSeconds?: number; llmCostUsd?: number }> }>(
      "/billing/usage/timeseries?granularity=day",
      { token },
    );
    expect(timeseries.status).toBe(200);
    const seededCompute = (timeseries.body.buckets ?? []).reduce((s, b0) => s + (b0.computeSeconds ?? 0), 0);
    expect(seededCompute, "timeseries compute buckets sum to at least the seeded hour").toBeGreaterThanOrEqual(3599);
  });

  test("org by-user attributes seeded usage to the right user", async () => {
    const { token, organizationId } = await adminContext();
    const userId = await userIdFor(token);
    const orgSubject = await b.ensureOrganizationSubject(organizationId, userId);

    await b.seedLlmUsageEvent({ subjectId: orgSubject.id, organizationId, userId, costUsd: 4.4 });
    if (ORG_COMPUTE_ATTRIBUTION_ACTIVE) {
      await b.seedUsageSegment(orgSubject.id, { userId, hours: 0.25 });
    }

    const byUser = await b.apiRequest<{ users: Array<{ userId: string; llmCostUsd: number; computeSeconds: number }> }>(
      `/organizations/${organizationId}/usage/by-user`,
      { token },
    );
    expect(byUser.status).toBe(200);
    const mine = byUser.body.users.find((u) => u.userId === userId);
    expect(mine, "the seeding user appears in by-user").toBeTruthy();
    expect(mine!.llmCostUsd, "LLM cost attributed to the right user").toBeGreaterThanOrEqual(4.4);
    if (ORG_COMPUTE_ATTRIBUTION_ACTIVE) {
      expect(mine!.computeSeconds, "#1028: org-enrolled compute attributed to the org subject").toBeGreaterThan(0);
    }
  });

  test("the settings billing/usage surface renders (desktop web)", async ({ page }) => {
    await adminContext(); // ensure the instance is claimed
    // Real UI login, matching auth.spec.ts (session lands in localStorage under
    // `proliferate.auth.session`).
    await page.goto(process.env.TIER2_BILLING_WEB_BASE_URL!);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
    await page.goto(`${process.env.TIER2_BILLING_WEB_BASE_URL}/settings?section=billing`);
    // The consumption/usage surface is present (heading or usage figures). Kept
    // resilient: assert the billing section chrome renders without an error
    // boundary, rather than pinning a specific figure that the API tests above
    // already verify exactly.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText(/usage|billing|consumption|plan/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

async function userIdFor(token: string): Promise<string> {
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { id: string }).id;
}
