// T2-BILL-15 (LiteLLM usage import: overlap-window pagination, cursor resume,
// dedup, payer/member attribution, needs_review fail-closed) and T2-BILL-6's
// exhaustion assertion (disabling the scoped gateway key only) — driven
// against the REAL `run_usage_import` + real enrollment sync
// (`ensure_user_enrollment`/`ensure_org_enrollment`), never direct-SQL
// `agent_llm_usage_event` seeding. The only fake here is the LiteLLM
// management/admin plane (tests/intent/fakes/litellm-management) — no
// inference call, no live LiteLLM. See stack/billing-import-global-setup.ts
// for why this is a separate Playwright project from specs/billing/*.

import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

import { test, adminContext, adminUserId, skipIfNoStripe } from "../billing/_fixtures.ts";
import {
  countUsageEvents,
  fetchFakeBlockedKeys,
  getOrgEnrollment,
  getUsageEvent,
  getUserEnrollment,
  runEnrollmentBackfillPass,
  runUsageImportPass,
  seedFakeSpendRows,
  seedLlmCreditGrant,
} from "../../stack/billing-usage-import.ts";

test.describe("T2-BILL-15: LiteLLM usage import — real pagination/cursor/dedup/attribution", () => {
  skipIfNoStripe(test);

  test("enrollment sync mints real virtual keys (personal + org) against the fake", async () => {
    const userId = await adminUserId();
    const { organizationId } = await adminContext();
    await runEnrollmentBackfillPass();

    const personal = await getUserEnrollment(userId);
    expect(personal, "personal enrollment row exists").toBeTruthy();
    expect(personal!.virtualKeyId, "a real virtual key was minted").toBeTruthy();
    expect(personal!.syncStatus).toBe("synced");

    const org = await getOrgEnrollment(organizationId, userId);
    expect(org, "org enrollment row exists (admin is a member)").toBeTruthy();
    expect(org!.virtualKeyId, "a distinct virtual key was minted for the org membership").toBeTruthy();
    expect(org!.virtualKeyId).not.toBe(personal!.virtualKeyId);
  });

  test("imports paginated spend exactly once, and a repeated tick (restart) adds nothing new", async () => {
    const userId = await adminUserId();
    await runEnrollmentBackfillPass();
    const personal = await getUserEnrollment(userId);
    expect(personal!.virtualKeyId).toBeTruthy();

    const now = new Date().toISOString();
    const requestIdA = `req-${randomUUID()}`;
    const requestIdB = `req-${randomUUID()}`;
    await seedFakeSpendRows([
      { request_id: requestIdA, api_key: personal!.virtualKeyId!, spend: 0.1, startTime: now },
      { request_id: requestIdB, api_key: personal!.virtualKeyId!, spend: 0.2, startTime: now },
    ]);

    const before = await countUsageEvents();
    await runUsageImportPass();
    const afterFirst = await countUsageEvents();
    expect(afterFirst - before, "both seeded rows imported exactly once").toBe(2);

    const eventA = await getUsageEvent(requestIdA);
    expect(eventA?.status).toBe("imported");
    expect(eventA?.costUsd).toBeCloseTo(0.1, 6);
    expect(eventA?.userId).toBe(userId);

    // Restart-safety / exactly-once: a second tick over the SAME overlap
    // window (no new fake rows) must not create duplicates — the unique
    // constraint on litellm_request_id dedupes even though the fake still
    // serves the same rows within the window.
    await runUsageImportPass();
    const afterSecond = await countUsageEvents();
    expect(afterSecond, "a repeated tick over an overlapping window adds no duplicate rows").toBe(afterFirst);
  });

  test("an unresolved virtual key becomes needs_review, fails closed (no silent attribution)", async () => {
    const unresolvedKey = `tok-unresolved-${randomUUID()}`;
    const requestId = `req-${randomUUID()}`;
    await seedFakeSpendRows([
      { request_id: requestId, api_key: unresolvedKey, spend: 1.23, startTime: new Date().toISOString() },
    ]);

    await runUsageImportPass();

    const event = await getUsageEvent(requestId);
    expect(event, "the row is still recorded, never silently dropped").toBeTruthy();
    expect(event!.status).toBe("needs_review");
    expect(event!.userId).toBeNull();
    expect(event!.organizationId).toBeNull();
    expect(event!.billingSubjectId).toBeNull();
  });

  test("member/payer attribution: org-enrolled spend attributes to the org subject, personal spend to the personal subject", async () => {
    const userId = await adminUserId();
    const { organizationId } = await adminContext();
    await runEnrollmentBackfillPass();
    const personal = await getUserEnrollment(userId);
    const org = await getOrgEnrollment(organizationId, userId);
    expect(personal!.virtualKeyId).toBeTruthy();
    expect(org!.virtualKeyId).toBeTruthy();

    const personalRequestId = `req-${randomUUID()}`;
    const orgRequestId = `req-${randomUUID()}`;
    const now = new Date().toISOString();
    await seedFakeSpendRows([
      { request_id: personalRequestId, api_key: personal!.virtualKeyId!, spend: 0.5, startTime: now },
      { request_id: orgRequestId, api_key: org!.virtualKeyId!, spend: 0.75, startTime: now },
    ]);

    await runUsageImportPass();

    const personalEvent = await getUsageEvent(personalRequestId);
    expect(personalEvent!.userId).toBe(userId);
    expect(personalEvent!.organizationId).toBeNull();
    expect(personalEvent!.billingSubjectId).toBe(personal!.billingSubjectId);

    const orgEvent = await getUsageEvent(orgRequestId);
    expect(orgEvent!.userId).toBe(userId);
    expect(orgEvent!.organizationId).toBe(organizationId);
    expect(orgEvent!.billingSubjectId).toBe(org!.billingSubjectId);
    expect(orgEvent!.billingSubjectId).not.toBe(personalEvent!.billingSubjectId);
  });
});

test.describe("T2-BILL-6: managed-LLM exhaustion disables only the scoped gateway key", () => {
  skipIfNoStripe(test);

  test("exhausting a subject's credit blocks its virtual key at the fake and flips budget_status, leaving other keys untouched", async () => {
    const userId = await adminUserId();
    const { organizationId } = await adminContext();
    await runEnrollmentBackfillPass();
    const personal = await getUserEnrollment(userId);
    const org = await getOrgEnrollment(organizationId, userId);
    expect(personal!.virtualKeyId).toBeTruthy();
    expect(org!.virtualKeyId).toBeTruthy();

    // A large, unambiguous spend drives remaining credit negative regardless
    // of whatever free/seed grants already exist on this subject.
    await seedLlmCreditGrant({ billingSubjectId: personal!.billingSubjectId, userId, amountUsd: 1 });
    const requestId = `req-${randomUUID()}`;
    await seedFakeSpendRows([
      { request_id: requestId, api_key: personal!.virtualKeyId!, spend: 1000, startTime: new Date().toISOString() },
    ]);

    await runUsageImportPass();

    const updated = await getUserEnrollment(userId);
    expect(updated!.budgetStatus).toBe("exhausted");

    const blocked = await fetchFakeBlockedKeys();
    expect(blocked, "the exhausted subject's own key is disabled").toContain(personal!.virtualKeyId);
    expect(blocked, "the org membership's separate key is not touched by personal exhaustion").not.toContain(
      org!.virtualKeyId,
    );
  });
});
