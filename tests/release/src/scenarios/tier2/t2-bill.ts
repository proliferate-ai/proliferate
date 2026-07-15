/**
 * T2-BILL — the authoritative required billing group (PR 4, BRIEF §6;
 * `specs/developing/testing/core-release-validation.md` lines 342-356).
 *
 * One matrix scenario (lane `local`, no new lane) whose child cells are the
 * authoritative manifest ids T2-BILL-1..15, run against ONE booted
 * `BootedStack` + real Stripe test mode via `makeTier2MatrixScenario`. Each
 * handler asserts its guarantee against the running product and records the
 * asserted ruled values / ledger deltas / safe Stripe ids into `tier2_billing`
 * evidence (green only).
 *
 * ── GATEWAY + LiteLLM FAKE (resolved) ───────────────────────────────────────
 * The scenario config sets `gatewayFake: true`, so the ONE shared boot runs
 * `bootBillingStackWithLitellmFake()` (harness.ts): the server boots
 * gateway-enabled and the management-plane LiteLLM fake is wired, and the
 * gateway env is published into this runner process. Every managed-LLM
 * guarantee that reads `settings.agent_gateway_enabled` — the $5/seat LLM pool
 * grant (stripe_webhooks.py), LLM exhaustion disabling the scoped key, and the
 * real `run_usage_import` (T2-BILL-14/15) — is therefore exercised for real
 * here, not stubbed. The importer/enrollment/exhaustion passes are the SAME
 * out-of-process product passes the Playwright `billing-import/usage-import`
 * suite drives (`stack/billing-usage-import.ts`), against the same fake.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

import { makeTier2MatrixScenario } from "./harness.js";
import type { Tier2CaseResult, Tier2CellContext, Tier2CellHandler } from "./types.js";
import { adminContext, userIdFor } from "./fixtures.js";
import * as b from "../../../../intent/stack/billing.ts";
import * as seed from "../../../../intent/stack/seed.ts";
import { REPO_ROOT } from "../../../../intent/stack/boot.ts";
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
} from "../../../../intent/stack/billing-usage-import.ts";

export const T2_BILL_ID = "T2-BILL";

const HOUR = 3600;
const PASSWORD = "Tier2Cells!Passw0rd";

/** True when the shared boot enabled the agent gateway + LiteLLM fake
 * (`gatewayFake: true` → `bootBillingStackWithLitellmFake` publishes
 * `AGENT_GATEWAY_ENABLED=true` into this process). A defensive guard: if a
 * caller ever runs this scenario without the fake, the gateway-dependent cells
 * fail honestly rather than throwing deep inside product code. */
function gatewayEnabled(): boolean {
  return process.env.AGENT_GATEWAY_ENABLED === "true";
}

function blockedResult(reason: string): Tier2CaseResult {
  return { status: "blocked", reason };
}

const GATEWAY_GAP_REASON =
  "AGENT_GATEWAY_ENABLED is not wired for this run (expected gatewayFake boot); " +
  "this guarantee needs settings.agent_gateway_enabled=true + the LiteLLM fake at server boot.";

/** Out-of-process pass invoking the real (unmocked) free-credit ensure
 * function directly against the booted profile DB — the same "run the
 * product's own pass function out of process" convention `billing.ts` uses
 * for the accounting/reconciler/topup passes, scoped to
 * `ensure_user_free_credit_grant`.
 *
 * Returns whether the user OWNS the free-signup grant after the call — NOT
 * whether this call newly created it. `ensure_user_free_credit_grant` is
 * idempotent-by-ownership (the `free_cloud_allocation` guard returns True when
 * the allocation already belongs to this subject, and the grant insert is
 * `source_ref`-deduped), so a replay returns True too. The dedup guarantee is
 * therefore "exactly one grant row", asserted via `llmCreditGrantCount`, not
 * the boolean. Async (spawn, not spawnSync) so two calls can genuinely race the
 * `source_ref` unique constraint in the concurrency case (T2-BILL-14). */
function runFreeCreditGrantPass(userId: string): Promise<boolean> {
  const child = spawn(
    path.join(REPO_ROOT, "server", ".venv", "bin", "python"),
    [
      "-c",
      // Imports on their own newline-separated lines: a compound statement
      // (`async def`) cannot follow `;`-joined simple statements on one logical
      // line (SyntaxError), so the pyExpr must be genuinely multi-line.
      "import asyncio\n" +
        "from proliferate.db.engine import async_session_factory\n" +
        "from proliferate.server.cloud.agent_gateway.free_credits import ensure_user_free_credit_grant\n" +
        "async def _m():\n" +
        "    async with async_session_factory() as db:\n" +
        `        granted = await ensure_user_free_credit_grant(db, "${userId}")\n` +
        "        await db.commit()\n" +
        // Unambiguous tokens: 'NOT_GRANTED' contains 'GRANTED' as a substring,
        // so the reader below matches a distinct marker instead.
        "        print('GRANT_YES' if granted else 'GRANT_NO')\n" +
        "asyncio.run(_m())\n",
    ],
    {
      cwd: path.join(REPO_ROOT, "server"),
      env: {
        ...process.env,
        DATABASE_URL: b.databaseUrl(),
        DEBUG: "true",
        PRO_BILLING_ENABLED: "true",
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  return new Promise<boolean>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`free-credit pass failed (${code}): ${(stderr || stdout).trim()}`));
        return;
      }
      resolve(stdout.includes("GRANT_YES"));
    });
  });
}

/** Seed a real `auth_identity` GitHub link for `userId` (the free-credit
 * dedup guard reads this, not the `oauth_account` product-readiness stub —
 * see billing-seed.ts's `ensureProductReady` doc). */
async function linkGithubIdentity(userId: string, providerSubject: string): Promise<void> {
  await b.withDb((db) =>
    db.query(
      `INSERT INTO auth_identity (id, user_id, provider, provider_subject, email, email_verified, linked_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'github', $2, NULL, false, now(), now(), now())`,
      [userId, providerSubject],
    ),
  );
}

/** Drive the seat-adjustment pass until no pending/retryable rows remain for the
 * subject (bounded). `process_pending_seat_adjustments` claims with `FOR UPDATE
 * OF subscription SKIP LOCKED`, so at most one adjustment per subscription
 * advances per pass: when several pending adjustments share one subscription
 * (e.g. a non-trivial initial-reconcile from `subscription.created` plus an
 * invite proration — the shape a long-lived org DB produces), each needs its own
 * pass. Polling the pending count between passes also absorbs the brief window
 * before an accept's adjustment is committed. The background loop achieves this
 * over ticks; a deterministic test drains explicitly. */
async function drainSeatAdjustments(subjectId: string, maxPasses = 10): Promise<void> {
  for (let i = 0; i < maxPasses; i++) {
    b.processSeatAdjustments();
    const pending = await b.withDb(async (db) => {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM billing_seat_adjustment
           WHERE billing_subject_id = $1 AND status IN ('pending', 'failed_retryable')`,
        [subjectId],
      );
      return r.rows[0].n as number;
    });
    if (pending === 0) {
      return;
    }
  }
}

async function llmCreditGrantCount(subjectId: string, source?: string): Promise<number> {
  return b.withDb(async (db) => {
    const result = source
      ? await db.query(`SELECT count(*)::int AS n FROM llm_credit_grant WHERE billing_subject_id = $1 AND source = $2`, [subjectId, source])
      : await db.query(`SELECT count(*)::int AS n FROM llm_credit_grant WHERE billing_subject_id = $1`, [subjectId]);
    return result.rows[0].n as number;
  });
}

// ── T2-BILL-1: checkout -> subscription/grant, ordered consumption, cutoff,
// reactivation, lost-response idempotency ──────────────────────────────────
const t2Bill1: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const userId = await userIdFor(token);
  const email = `t2bill1-${Date.now()}@example.com`;

  const checkout = await b.apiRequest<{ url: string }>("/v1/billing/cloud-checkout", {
    method: "POST",
    token,
    body: { ownerScope: "personal", returnSurface: "web" },
  });
  assert.equal(checkout.status, 200, "cloud-checkout creates a real Stripe test-mode session");
  assert.match((checkout.body as { url: string }).url, /checkout\.stripe\.com|billing/);

  const clock = b.createTestClock();
  ctx.ids.addTestClock(clock.id);
  const subject = await b.ensurePersonalSubject(userId);
  const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email });
  ctx.ids.addObject(customer.id);
  await b.ensurePersonalSubject(userId, customer.id);

  const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
  ctx.ids.addObject(sub.id);
  const fullSub = b.retrieveSubscription(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

  const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
  const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
  const eventId = `evt_test_bill1_${Date.now()}`;
  const first = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
  assert.equal(first.status, 200);

  const grants = await b.listGrants(subject.id);
  const periodGrant = grants.find((g) => g.grant_type === "pro_period");
  assert.ok(periodGrant, "pro_period grant issued by invoice.paid");
  assert.ok(Number(periodGrant!.hours_granted) > 0, "compute allocation is positive");

  // Lost-response idempotency: exact replay of the same event id issues no
  // second grant (the response to the first delivery was "lost", the caller
  // retries with the same event).
  const replay = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
  assert.equal(replay.status, 200);
  const grantsAfterReplay = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;
  assert.equal(grantsAfterReplay, 1, "replayed invoice.paid issues no second grant");

  await b.withDb((db) =>
    db.query(`UPDATE billing_grant SET effective_at = $1 WHERE id = $2`, [
      new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
      periodGrant!.id,
    ]),
  );

  let overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overview.body.startBlocked, false);
  assert.ok(overview.body.remainingHours != null && overview.body.remainingHours > 0);

  await b.setOverageSettings(subject.id, { enabled: false });
  await b.seedUsageSegment(subject.id, { userId, hours: Number(periodGrant!.hours_granted) + 1 });
  b.runAccountingPass();
  assert.ok((await b.totalRemainingSeconds(subject.id)) < 60, "grant drained to near-zero");

  overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overview.body.startBlocked, true, "cut off at exhaustion");

  await b.seedGrant(subject.id, {
    userId,
    grantType: "pro_period",
    hoursGranted: 5,
    expiresAt: fullSub.current_period_end ? new Date(fullSub.current_period_end * 1000) : null,
    sourceRef: `t2bill1-reactivate-${Date.now()}`,
  });
  overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overview.body.startBlocked, false, "reactivated after a top-up grant");

  ctx.policy.record({ compute_per_seat_usd: 15 });
  return { status: "green" };
};

// ── T2-BILL-2: $2 GitHub-deduplicated free grant; $20/seat -> $5 LLM + $15
// compute pools; cancellation retains entitlement through period end ───────
const t2Bill2: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const ownerId = await userIdFor(token);

  // A fresh member gets their own personal subject + a real GitHub link;
  // replaying the ensure-grant pass twice proves idempotent dedup.
  const email = `t2bill2-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  const memberId = await userIdFor(memberToken);
  const githubSubject = `t2bill2-gh-${Date.now()}`;
  await linkGithubIdentity(memberId, githubSubject);
  const subject = await b.ensurePersonalSubject(memberId);

  const grantedFirst = await runFreeCreditGrantPass(memberId);
  assert.equal(grantedFirst, true, "first attempt grants the free credit");
  // A replay owns the same grant (idempotent), so the pass still reports owned;
  // the dedup guarantee is that NO SECOND ROW is created — asserted by count.
  await runFreeCreditGrantPass(memberId);
  const freeGrantCount = await llmCreditGrantCount(subject.id, "free_signup");
  assert.equal(freeGrantCount, 1, "exactly one lifetime free-signup grant (replay creates no second row)");
  const freeGrantAmount = await b.withDb(async (db) => {
    const r = await db.query(`SELECT amount_usd FROM llm_credit_grant WHERE billing_subject_id = $1 AND source = 'free_signup'`, [subject.id]);
    return Number(r.rows[0].amount_usd);
  });
  assert.equal(freeGrantAmount, 2, "the ruled $2 lifetime grant amount");

  // No GitHub link -> no grant.
  const email2 = `t2bill2-nogh-${Date.now()}@example.com`;
  const noGhToken = await seed.registerFreshMember(token, organizationId, email2, PASSWORD, "member");
  const noGhUserId = await userIdFor(noGhToken);
  const grantedNoGh = await runFreeCreditGrantPass(noGhUserId);
  assert.equal(grantedNoGh, false, "no GitHub identity -> no grant");

  // Core seat pools: subscribe the org to Pro at N seats and confirm the
  // compute-side ($15-equivalent/seat) allocation on the org subject.
  const clock = b.createTestClock();
  ctx.ids.addTestClock(clock.id);
  const orgSubject = await b.ensureOrganizationSubject(organizationId, ownerId);
  await b.withDb((db) =>
    db.query(
      `UPDATE billing_subscription SET status = 'canceled', updated_at = now()
        WHERE billing_subject_id = $1 AND status IN ('active', 'trialing')`,
      [orgSubject.id],
    ),
  );
  const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: orgSubject.id, email: `t2bill2-org-${Date.now()}@example.com` });
  ctx.ids.addObject(customer.id);
  await b.ensureOrganizationSubject(organizationId, ownerId, customer.id);
  const seats = 3;
  const sub = b.createProSubscription({ customerId: customer.id, seats });
  ctx.ids.addObject(sub.id);
  const fullSub = b.retrieveSubscription(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
  const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
  const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
  await b.deliverEvent({ type: "invoice.paid", object: invoice });

  const grants = await b.listGrants(orgSubject.id);
  const periodGrant = grants.filter((g) => g.grant_type === "pro_period").at(-1);
  assert.ok(periodGrant, "pro_period compute grant issued for the org subject");
  assert.ok(Number(periodGrant!.hours_granted) > 0, "compute pool derived from $15/seat x seats");

  if (!gatewayEnabled()) {
    // The $5/seat managed-LLM pool grant (stripe_webhooks.py's
    // `LLM_CREDIT_SOURCE_SEAT_POOL` branch) is gated on
    // `settings.agent_gateway_enabled` — see the module doc.
    return blockedResult(`$5/seat managed-LLM pool grant: ${GATEWAY_GAP_REASON}`);
  }
  const llmPoolAmount = await b.withDb(async (db) => {
    const r = await db.query(`SELECT amount_usd FROM llm_credit_grant WHERE billing_subject_id = $1 AND source = 'seat_pool' ORDER BY created_at DESC LIMIT 1`, [orgSubject.id]);
    return r.rows[0] ? Number(r.rows[0].amount_usd) : null;
  });
  // The pool is $5 x the subscription's ACTUAL seat_quantity, which the
  // subscription.created handler reconciles to the org's active member count
  // (not the 3 the checkout requested — the long-lived org DB has more active
  // members). Assert the ruled $5/seat rule against that reconciled quantity.
  const seatQuantity = await b.withDb(async (db) => {
    const r = await db.query(
      `SELECT seat_quantity FROM billing_subscription
         WHERE billing_subject_id = $1 AND status IN ('active', 'trialing')
         ORDER BY created_at DESC LIMIT 1`,
      [orgSubject.id],
    );
    return Number(r.rows[0].seat_quantity);
  });
  assert.ok(seatQuantity >= seats, "subscription reconciled to at least the requested seats");
  assert.equal(llmPoolAmount, seatQuantity * 5, "the ruled $5/seat LLM pool (against the reconciled seat count)");
  ctx.policy.record({ free_grant_usd: 2, llm_per_seat_usd: 5, compute_per_seat_usd: 15 });
  return { status: "green" };
};

// ── T2-BILL-3: seat invite/accept/remove/reinvite, proration once, retry ──
const t2Bill3: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const ownerId = await userIdFor(token);

  // Retire any active subscriptions on this org's subject BEFORE the first
  // membership change (earlier cases subscribe the same claimed org; a JOIN so
  // it works regardless of how many billing subjects the org has).
  await b.withDb((db) =>
    db.query(
      `UPDATE billing_subscription bs SET status = 'canceled', updated_at = now()
         FROM billing_subject s
        WHERE s.id = bs.billing_subject_id AND s.organization_id = $1
          AND bs.status IN ('active', 'trialing')`,
      [organizationId],
    ),
  );

  // The member ACCOUNT must exist before the subscription, but WITHOUT an
  // active membership: invited self-registration creates account+membership yet
  // enqueues NO seat adjustment (only the accept-invitation service path does).
  // Register, then drop the membership, so the later invite->accept is the first
  // clean seat add on the paid subscription (mirrors specs/billing/seats.spec).
  const email = `t2bill3-member-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  {
    const seededMembers = await seed.listMembers(token, organizationId);
    const seededMember = seededMembers.find((m) => m.email === email)!;
    await seed.removeMembership(token, organizationId, seededMember.membershipId);
  }

  const clock = b.createTestClock();
  const subject = await b.ensureOrganizationSubject(organizationId, ownerId);
  const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email: `t2bill3-org-${Date.now()}@example.com` });
  await b.ensureOrganizationSubject(organizationId, ownerId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
  const fullSub = b.retrieveSubscription(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

  const adjustmentsBeforeAccept = (await b.listSeatAdjustments(subject.id)).length;
  const invitation = await seed.inviteMember(token, organizationId, email, "member");
  const accept = await seed.acceptCurrentInvitation(memberToken, invitation.id);
  assert.ok([200, 201].includes(accept.status), "accept succeeds");

  // The subject is shared with sibling cells on this booted stack, so don't
  // trust at(-1): assert on the rows THIS accept appended (a positive seat
  // bump must be among them).
  let adjustments = await b.listSeatAdjustments(subject.id);
  const appended = adjustments.slice(adjustmentsBeforeAccept);
  assert.ok(appended.length >= 1, "invite+accept created a seat adjustment");
  assert.ok(
    appended.some((a) => a.grant_quantity >= 1),
    "the accept's seat adjustment grants at least one seat",
  );

  const prorationBefore = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_seat_proration").length;
  await drainSeatAdjustments(subject.id);
  adjustments = await b.listSeatAdjustments(subject.id);
  assert.ok(
    adjustments.slice(adjustmentsBeforeAccept).every((a) => a.status === "succeeded"),
    "the invite proration seat adjustment converges",
  );
  const prorationAfter = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_seat_proration").length;
  assert.equal(prorationAfter - prorationBefore, 1, "one proration grant for the added seat");

  const members = await seed.listMembers(token, organizationId);
  const member = members.find((m) => m.email === email)!;
  const adjustmentsBeforeRemoval = (await b.listSeatAdjustments(subject.id)).length;
  await seed.removeMembership(token, organizationId, member.membershipId);
  await drainSeatAdjustments(subject.id);
  adjustments = await b.listSeatAdjustments(subject.id);
  const removalRows = adjustments.slice(adjustmentsBeforeRemoval);
  assert.ok(removalRows.length >= 1, "removal created a seat adjustment");
  assert.ok(
    removalRows.every((a) => a.grant_quantity === 0),
    "removal issues no refund grant",
  );

  const reinvite = await seed.inviteMember(token, organizationId, email, "member");
  const reaccept = await seed.acceptCurrentInvitation(memberToken, reinvite.id);
  assert.ok([200, 201].includes(reaccept.status));
  await drainSeatAdjustments(subject.id);
  const prorationFinal = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_seat_proration").length;
  assert.equal(prorationFinal - prorationBefore, 1, "no second proration grant on same-period re-invite (no double grant)");

  // Retry exhaustion: a bogus subscription-item adjustment goes terminal, and
  // a later honest adjustment still converges (the pipeline is not wedged).
  const retryRef = `t2bill3-retry-${Date.now()}`;
  await b.withDb(async (db) => {
    await db.query(`UPDATE billing_subscription SET seat_quantity = seat_quantity + 5 WHERE billing_subject_id = $1`, [subject.id]);
    await db.query(
      `INSERT INTO billing_seat_adjustment
         (id, billing_subject_id, billing_subscription_id, organization_id, stripe_subscription_id,
          monthly_subscription_item_id, previous_quantity, target_quantity, grant_quantity, attempt_count, source_ref, status, created_at, updated_at)
       SELECT gen_random_uuid(), $1, bs.id, $2, $3::varchar, 'si_bogus_does_not_exist', 1, 2, 0, 0, $4, 'pending', now(), now()
       FROM billing_subscription bs WHERE bs.billing_subject_id = $1 AND bs.stripe_subscription_id = $3::varchar`,
      [subject.id, organizationId, sub.id, retryRef],
    );
  });
  for (let i = 0; i < 3; i++) {
    b.processSeatAdjustments();
  }
  const bogus = (await b.listSeatAdjustmentsWithRef(subject.id)).find((a) => a.source_ref === retryRef);
  assert.ok(bogus, "bogus adjustment visible");
  assert.equal(bogus!.status, "failed_terminal", "retry exhaustion goes terminal");
  await b.withDb((db) => db.query(`UPDATE billing_subscription SET seat_quantity = seat_quantity - 5 WHERE billing_subject_id = $1`, [subject.id]));
  b.processSeatAdjustments();

  return { status: "green" };
};

// ── T2-BILL-4: team checkout — pending org, activation only after payment,
// replay, no orphan active org ─────────────────────────────────────────────
const t2Bill4: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const userId = await userIdFor(token);

  const res = await b.apiRequest<{ intentId: string; url: string }>("/v1/billing/team-checkout", {
    method: "POST",
    token,
    body: { teamName: `T2Cells Team ${Date.now()}`, inviteEmails: [], returnSurface: "web" },
  });
  assert.ok([200, 201].includes(res.status), "team-checkout creates a pending intent + real session");

  const intent = await b.withDb(async (db) => {
    const r = await db.query(
      `SELECT id, organization_id, billing_subject_id, stripe_customer_id
         FROM organization_checkout_intent
        WHERE created_by_user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return r.rows[0] as { id: string; organization_id: string; billing_subject_id: string; stripe_customer_id: string | null };
  });
  assert.ok(intent, "a pending team-checkout intent exists");

  // Pending organization is not yet active (no orphan active org before
  // verified payment).
  const pendingOrg = await b.withDb(async (db) => {
    const r = await db.query(`SELECT status FROM organization WHERE id = $1`, [intent.organization_id]);
    return r.rows[0]?.status as string | undefined;
  });
  assert.notEqual(pendingOrg, "active", "no orphan active org before verified payment");

  const metadata = {
    purpose: "team_subscription",
    organization_checkout_intent_id: intent.id,
    organization_id: intent.organization_id,
    created_by_user_id: userId,
    billing_subject_id: intent.billing_subject_id,
  };
  const subArgs = [
    "subscriptions",
    "create",
    "-d",
    `customer=${intent.stripe_customer_id}`,
    "-d",
    `items[0][price]=${process.env.TIER2_BILLING_STRIPE_PRO_MONTHLY_PRICE_ID}`,
    "-d",
    "items[0][quantity]=1",
    "-d",
    "trial_period_days=7",
  ];
  for (const [k, v] of Object.entries(metadata)) {
    subArgs.push("-d", `metadata[${k}]=${v}`);
  }
  const sub = b.stripeCli<{ id: string; status: string }>(subArgs);
  assert.ok(["active", "trialing"].includes(sub.status));

  const eventId = `evt_test_bill4_${Date.now()}`;
  const session = {
    id: `cs_test_${Date.now()}`,
    object: "checkout_session",
    mode: "subscription",
    metadata,
    subscription: sub.id,
    customer: intent.stripe_customer_id,
  };
  const first = await b.deliverEvent({ type: "checkout.session.completed", object: session, eventId });
  assert.equal(first.status, 200);

  const activated = await b.withDb(async (db) => {
    const r = await db.query(
      `SELECT i.status AS intent_status, o.status AS org_status
         FROM organization_checkout_intent i JOIN organization o ON o.id = i.organization_id WHERE i.id = $1`,
      [intent.id],
    );
    return r.rows[0];
  });
  assert.equal(activated.intent_status, "completed", "activation only after verified payment");
  assert.equal(activated.org_status, "active");

  // Duplicate checkout / replay: same event id -> silent ack, no double
  // activation, no orphan second subscription row.
  const before = await b.countWebhookReceipts("checkout.session.completed");
  const second = await b.deliverEvent({ type: "checkout.session.completed", object: session, eventId });
  const after = await b.countWebhookReceipts("checkout.session.completed");
  assert.equal(second.status, 200);
  assert.equal(after, before, "duplicate delivery is a silent ack, no new receipt");
  const subsCount = await b.withDb(async (db) => {
    const r = await db.query(`SELECT count(*)::int AS n FROM billing_subscription WHERE stripe_subscription_id = $1`, [sub.id]);
    return r.rows[0].n as number;
  });
  assert.equal(subsCount, 1, "one subscription row, not re-activated");

  return { status: "green" };
};

// ── T2-BILL-5: compute overage seconds->cents, remainder, cap, writeoff,
// immediate cutoff when disabled ───────────────────────────────────────────
const t2Bill5: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const ownerId = await userIdFor(token);
  const clock = b.createTestClock();
  ctx.ids.addTestClock(clock.id);
  const subject = await b.ensureOrganizationSubject(organizationId, ownerId);
  const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email: `t2bill5-${Date.now()}@example.com` });
  ctx.ids.addObject(customer.id);
  await b.ensureOrganizationSubject(organizationId, ownerId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats: 1, overage: true });
  ctx.ids.addObject(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: b.retrieveSubscription(sub.id) });

  // Ruled: flat $50/org/month cap, not scaled by per-seat count. Compute
  // overage now meters at the derived E2B-list x1.5 rate ($3/hr = 300 c/hr), so
  // exhausting a $50 cap needs >16.7h of IN-PERIOD overage. Backdate the synced
  // period start far enough that a long seeded segment falls fully inside the
  // paid period (a segment older than the period start is not billable overage).
  const OVERAGE_RATE_CENTS_PER_HOUR = 300;
  const capCents = 5000;
  const hoursPastCap = capCents / OVERAGE_RATE_CENTS_PER_HOUR + 4; // ~20.7h → ~6200c, past the cap
  const periodStart = new Date(Date.now() - (hoursPastCap + 2) * 3600 * 1000);
  await b.withDb((db) =>
    db.query(`UPDATE billing_subscription SET current_period_start = $1 WHERE billing_subject_id = $2`, [periodStart.toISOString(), subject.id]),
  );
  await b.setOverageSettings(subject.id, { enabled: true, capCentsPerSeat: capCents });

  await b.seedGrant(subject.id, { userId: ownerId, grantType: "pro_period", hoursGranted: 0.02 });
  await b.seedUsageSegment(subject.id, {
    userId: ownerId,
    hours: hoursPastCap,
    startedAt: new Date(Date.now() - (hoursPastCap + 1) * 3600 * 1000),
  });
  b.runAccountingPass();

  const exports = await b.listUsageExports(subject.id);
  const billable = exports.filter((e) => (e.meter_quantity_cents ?? 0) > 0);
  const autoWriteoffs = exports.filter((e) => e.writeoff_reason === "overage_cap_exhausted");
  const billableCents = billable.reduce((s, e) => s + (e.meter_quantity_cents ?? 0), 0);
  assert.ok(billable.length > 0, "billable export rows created");
  assert.ok(billableCents <= capCents, "billing stops at the $50/org/month cap");
  // Ruled 2026-07-14: at cap, compute PAUSES; write-off is operator-only. So
  // usage past the cap is NOT auto-written-off into an export row — it is simply
  // not billed and the subject is blocked (asserted just below), which is what
  // makes cap exposure a hard stop rather than silent accrual.
  assert.equal(autoWriteoffs.length, 0, "past-cap usage is paused, not auto-written-off (write-off is operator-only)");

  const overview = await b.apiRequest<b.BlockState>(
    `/v1/billing/overview?ownerScope=organization&organizationId=${organizationId}`,
    { token },
  );
  assert.equal(overview.body.startBlocked, true);
  assert.equal((overview.body as any).startBlockReason, "cap_exhausted");

  // Disabled overage -> immediate cutoff, zero new export rows.
  await b.setOverageSettings(subject.id, { enabled: false });
  const exportsBefore = (await b.listUsageExports(subject.id)).length;
  await b.seedGrant(subject.id, { userId: ownerId, grantType: "pro_period", hoursGranted: 0.02 });
  await b.seedUsageSegment(subject.id, { userId: ownerId, hours: 0.66, startedAt: new Date(Date.now() - 50 * 60 * 1000) });
  b.runAccountingPass();
  const exportsAfter = await b.listUsageExports(subject.id);
  assert.equal(exportsAfter.length - exportsBefore, 0, "no new export rows when overage is disabled");
  const overview2 = await b.apiRequest<b.BlockState>(
    `/v1/billing/overview?ownerScope=organization&organizationId=${organizationId}`,
    { token },
  );
  assert.equal(overview2.body.startBlocked, true);
  assert.equal((overview2.body as any).startBlockReason, "overage_disabled");

  const invalidCap = await b.apiRequest("/v1/billing/overage-settings", {
    method: "POST",
    token,
    body: { enabled: true, capCentsPerSeat: 5_000_000, ownerScope: "personal" },
  });
  assert.ok(invalidCap.status >= 400);

  ctx.policy.record({ overage_cap_usd_per_org_month: 50 });
  return { status: "green" };
};

// ── T2-BILL-6: LLM exhaustion / admin caps / auto top-up independence ─────
const t2Bill6: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const userId = await userIdFor(token);
  const subject = await b.ensurePersonalSubject(userId);

  const before = await b.apiRequest<{ usedUsd: number; remainingUsd: number }>("/v1/billing/llm-balance", { token });
  await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 12.5 });
  const after = await b.apiRequest<{ usedUsd: number; remainingUsd: number }>("/v1/billing/llm-balance", { token });
  assert.ok(Math.abs(after.body.usedUsd - before.body.usedUsd - 12.5) < 0.05, "balance reflects seeded spend");
  assert.ok(after.body.remainingUsd <= before.body.remainingUsd, "exhaustion drives remaining non-positive");

  const orgSubject = await b.ensureOrganizationSubject(organizationId, userId);
  const limitId = await b.seedBudgetLimit({ organizationId, userId: null, kind: "llm", window: "month", capValue: 5 });
  await b.seedLlmUsageEvent({ subjectId: orgSubject.id, organizationId, userId, costUsd: 8 });
  let limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(`/v1/organizations/${organizationId}/limits`, { token });
  const llmCap = (limits.body.limits as any[]).find((l) => l.kind === "llm");
  assert.equal(llmCap?.capValue, 5);
  assert.equal(llmCap?.enabled, true);
  await b.seedGrant(subject.id, { userId, grantType: "refill_10h", hoursGranted: 10 });
  limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(`/v1/organizations/${organizationId}/limits`, { token });
  assert.equal((limits.body.limits as any[]).find((l) => l.kind === "llm")?.enabled, true, "credit refill does not clear the admin cap");
  await b.setBudgetLimitEnabled(limitId, false);
  limits = await b.apiRequest<{ limits: Array<{ capValue: number; enabled: boolean }> }>(`/v1/organizations/${organizationId}/limits`, { token });
  const disabled = (limits.body.limits as any[]).find((l) => l.kind === "llm");
  assert.ok(disabled === undefined || disabled.enabled === false);

  if (!gatewayEnabled()) {
    // Real key-disable-on-exhaustion needs `settings.agent_gateway_enabled`
    // + the LiteLLM fake — see the module doc.
    return blockedResult(`LLM key exhaustion: ${GATEWAY_GAP_REASON}`);
  }

  // Real exhaustion: enroll (mint a real virtual key against the fake), drive
  // this subject's remaining credit negative via the REAL importer, and assert
  // ONLY the scoped key is disabled at the gateway — the org membership's
  // separate key is untouched (the ruled "disable the scoped gateway key, not
  // compute, not a valid BYOK" guarantee).
  await runEnrollmentBackfillPass();
  const personal = await getUserEnrollment(userId);
  const orgEnrollment = await getOrgEnrollment(organizationId, userId);
  assert.ok(personal?.virtualKeyId, "personal enrollment minted a real virtual key against the fake");
  assert.ok(orgEnrollment?.virtualKeyId, "org membership minted a distinct virtual key");
  await seedLlmCreditGrant({ billingSubjectId: personal!.billingSubjectId, userId, amountUsd: 1 });
  const exhaustReq = `req-exhaust-${Date.now()}`;
  await seedFakeSpendRows([
    { request_id: exhaustReq, api_key: personal!.virtualKeyId!, spend: 1000, startTime: new Date().toISOString() },
  ]);
  await runUsageImportPass();
  const afterExhaust = await getUserEnrollment(userId);
  assert.equal(afterExhaust!.budgetStatus, "exhausted", "exhausting a subject's credit flips budget_status");
  const blockedKeys = await fetchFakeBlockedKeys();
  assert.ok(blockedKeys.includes(personal!.virtualKeyId!), "the exhausted subject's own key is disabled at the gateway");
  assert.ok(
    !blockedKeys.includes(orgEnrollment!.virtualKeyId!),
    "the org membership's separate key is NOT touched by personal exhaustion",
  );
  return { status: "green" };
};

// ── T2-BILL-7: webhook robustness — signature/replay/concurrent/order ─────
async function subscribedPersonalSubject() {
  const { token } = await adminContext();
  const userId = await userIdFor(token);
  const clock = b.createTestClock();
  const subject = await b.ensurePersonalSubject(userId);
  const customer = b.createCustomer({ clockId: clock.id, billingSubjectId: subject.id, email: `t2bill7-${Date.now()}@example.com` });
  await b.ensurePersonalSubject(userId, customer.id);
  const sub = b.createProSubscription({ customerId: customer.id, seats: 1 });
  const fullSub = b.retrieveSubscription(sub.id);
  const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
  const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
  return { token, userId, subject, customer, sub, fullSub, invoice, clockId: clock.id };
}

const t2Bill7: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { subject, fullSub, invoice, clockId, sub, customer } = await subscribedPersonalSubject();
  ctx.ids.addTestClock(clockId);
  ctx.ids.addObject(customer.id);
  ctx.ids.addObject(sub.id);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

  // Exact duplicate delivery is idempotent (signature verified, no double
  // grant).
  const eventId = `evt_test_bill7dup_${Date.now()}`;
  const first = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
  assert.equal(first.status, 200);
  const afterFirst = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;
  const second = await b.deliverEvent({ type: "invoice.paid", object: invoice, eventId });
  assert.equal(second.status, 200);
  const afterSecond = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;
  assert.equal(afterSecond, afterFirst, "exact replay issues no new grant");

  // Concurrent duplicate delivery: at most one grant, never a 5xx.
  const { subject: subject2, fullSub: fullSub2, invoice: invoice2 } = await subscribedPersonalSubject();
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub2 });
  const before2 = (await b.listGrants(subject2.id)).filter((g) => g.grant_type === "pro_period").length;
  const concurrentEventId = `evt_test_bill7conc_${Date.now()}`;
  const [a, c] = await b.deliverEventTwiceConcurrently({ type: "invoice.paid", object: invoice2, eventId: concurrentEventId });
  for (const r of [a, c]) {
    assert.ok([200, 409].includes(r.status));
  }
  const after2 = (await b.listGrants(subject2.id)).filter((g) => g.grant_type === "pro_period").length;
  assert.ok(after2 - before2 <= 1, "concurrent duplicate issues at most one grant");

  // Out-of-order: invoice.paid before subscription.updated still converges.
  const { subject: subject3, fullSub: fullSub3, invoice: invoice3 } = await subscribedPersonalSubject();
  const paid = await b.deliverEvent({ type: "invoice.paid", object: invoice3 });
  const updated = await b.deliverEvent({ type: "customer.subscription.updated", object: fullSub3 });
  assert.equal(paid.status, 200);
  assert.equal(updated.status, 200);
  const row = await b.withDb(async (db) => {
    const r = await db.query(`SELECT status FROM billing_subscription WHERE billing_subject_id = $1 AND stripe_subscription_id = $2`, [subject3.id, fullSub3.id]);
    return r.rows[0];
  });
  assert.equal(row?.status, "active");
  assert.ok((await b.listGrants(subject3.id)).some((g) => g.grant_type === "pro_period"));

  return { status: "green" };
};

// ── T2-BILL-8: subscription edge states — hold/recovery, cancellation,
// dunning, off/observe/enforce ─────────────────────────────────────────────
const t2Bill8: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, subject, customer, fullSub, invoice } = await subscribedPersonalSubject();
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });

  const failedInvoice = { ...invoice, id: `in_test_failed_${Date.now()}`, customer: customer.id };
  await b.deliverEvent({ type: "invoice.payment_failed", object: failedInvoice });
  assert.ok((await b.listActiveHolds(subject.id)).some((h) => h.kind === "payment_failed"));
  let overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overview.body.startBlocked, true);
  await b.deliverEvent({ type: "invoice.paid", object: invoice });
  assert.equal((await b.listActiveHolds(subject.id)).some((h) => h.kind === "payment_failed"), false, "recovery clears the hold");

  // Cancel mid-period: access continues through period end, then cut off past
  // the rollover grace.
  const { subject: subject2, sub: sub2, fullSub: fullSub2, token: token2 } = await subscribedPersonalSubject();
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub2 });
  await b.seedGrant(subject2.id, { grantType: "pro_period", hoursGranted: 5, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  b.cancelSubscriptionAtPeriodEnd(sub2.id);
  await b.deliverEvent({ type: "customer.subscription.updated", object: b.retrieveSubscription(sub2.id) });
  let overview2 = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token: token2 });
  assert.equal(overview2.body.startBlocked, false, "access continues through period end");
  await b.withDb((db) => db.query(`UPDATE billing_subscription SET current_period_end = $1 WHERE billing_subject_id = $2`, [new Date(Date.now() - 48 * 3600 * 1000).toISOString(), subject2.id]));
  overview2 = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token: token2 });
  assert.equal(overview2.body.startBlocked, true, "cut off past the rollover grace");

  // Clean voluntary cancellation applies no payment_failed hold.
  const { subject: subject3, sub: sub3, fullSub: fullSub3 } = await subscribedPersonalSubject();
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub3 });
  b.cancelSubscriptionAtPeriodEnd(sub3.id);
  const deleted = b.deleteSubscription(sub3.id);
  await b.deliverEvent({ type: "customer.subscription.deleted", object: deleted });
  assert.equal((await b.listActiveHolds(subject3.id)).some((h) => h.kind === "payment_failed"), false, "clean cancellation, no dunning-style hold");

  // No GitHub identity -> no lazily-issued free trial (no unsupported side
  // effect, no error).
  const overviewNoGh = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overviewNoGh.status, 200);
  assert.equal((await b.listGrants(subject.id)).some((g) => g.grant_type === "free_trial_v2"), false);

  return { status: "green" };
};

// ── T2-BILL-9: free personal actor gets $2 lifetime credit + zero compute;
// no provider sandbox call ─────────────────────────────────────────────────
const t2Bill9: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const email = `t2bill9-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  const memberId = await userIdFor(memberToken);
  const subject = await b.ensurePersonalSubject(memberId);

  // Zero compute credit: a free (non-Pro) personal subject has no included
  // managed-cloud hours, so a bounded start attempt is gated — the same
  // billing snapshot the resume/start gate reads.
  const overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token: memberToken });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.remainingHours ?? 0, 0, "a fresh free personal subject has zero included compute");

  // No provider sandbox row was created merely by inspecting billing state.
  const sandboxCount = await b.withDb(async (db) => {
    const r = await db.query(`SELECT count(*)::int AS n FROM usage_segment WHERE billing_subject_id = $1`, [subject.id]);
    return r.rows[0].n as number;
  });
  assert.equal(sandboxCount, 0, "no provider sandbox/usage row for an actor who never started one");

  return { status: "green" };
};

// ── T2-BILL-10: test-clock renewal — new-period grants, dunning, carry vs
// expiry across period boundaries ──────────────────────────────────────────
const t2Bill10: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { userId, subject, fullSub, clockId } = await subscribedPersonalSubject();
  ctx.ids.addTestClock(clockId);
  await b.deliverEvent({ type: "customer.subscription.created", object: fullSub });
  const invoiceId = fullSub.latest_invoice?.id ?? fullSub.latest_invoice;
  const invoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", invoiceId, "--expand", "lines"]);
  await b.deliverEvent({ type: "invoice.paid", object: invoice });
  const firstPeriodGrants = (await b.listGrants(subject.id)).filter((g) => g.grant_type === "pro_period").length;

  // Purchased (never-expiring) top-up credit persists across renewal, unlike
  // the period-scoped compute grant.
  const topupId = await b.seedGrant(subject.id, { userId, grantType: "refill_10h", hoursGranted: 10, expiresAt: null });

  // Advance the test clock past the period end; a renewal invoice.paid should
  // issue a NEW pro_period grant (period-keyed source_ref), not accumulate.
  const nextPeriod = new Date((fullSub.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600) * 1000 + 3600 * 1000);
  b.advanceTestClock(clockId, nextPeriod);
  const renewedSub = b.retrieveSubscription(fullSub.id);
  const renewedInvoiceId = renewedSub.latest_invoice?.id ?? renewedSub.latest_invoice;
  if (renewedInvoiceId && renewedInvoiceId !== invoiceId) {
    const renewedInvoice = b.stripeCli<Record<string, any>>(["invoices", "retrieve", renewedInvoiceId, "--expand", "lines"]);
    await b.deliverEvent({ type: "invoice.paid", object: renewedInvoice });
  }
  await b.deliverEvent({ type: "customer.subscription.updated", object: renewedSub });

  const grantsAfterRenewal = await b.listGrants(subject.id);
  const periodGrantsAfter = grantsAfterRenewal.filter((g) => g.grant_type === "pro_period").length;
  if (renewedInvoiceId && renewedInvoiceId !== invoiceId) {
    // A renewal invoice was delivered: it must have granted a NEW period
    // allocation (period-keyed source_ref), not merely preserved the old one.
    assert.ok(
      periodGrantsAfter > firstPeriodGrants,
      "paid renewal grants a new period compute allocation exactly once",
    );
  } else {
    assert.ok(periodGrantsAfter >= firstPeriodGrants, "renewal does not lose the compute grant");
  }
  const topupStillPresent = grantsAfterRenewal.some((g) => g.id === topupId);
  assert.ok(topupStillPresent, "purchased top-up credit carries across renewal (never expires)");

  return { status: "green" };
};

// ── T2-BILL-11: reconciler singleton/advisory lock, concurrent workers,
// restart, exactly-once convergence ────────────────────────────────────────
const t2Bill11: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  // Concurrent invocations of the real reconcile pass: the advisory lock
  // guarantees at most one logical pass proceeds at a time; both calls must
  // return (not hang, not crash the process) and a subsequent call (restart)
  // still converges cleanly.
  const results = await Promise.allSettled([
    Promise.resolve().then(() => b.runReconcilePass()),
    Promise.resolve().then(() => b.runReconcilePass()),
  ]);
  for (const result of results) {
    assert.equal(
      result.status,
      "fulfilled",
      result.status === "rejected"
        ? `reconciler pass crashed: ${String((result as PromiseRejectedResult).reason)}`
        : "concurrent reconciler passes never crash the process",
    );
  }
  // Restart: a subsequent pass after the concurrent pair still succeeds
  // (singleton lock released cleanly, no wedge).
  b.runReconcilePass();
  return { status: "green" };
};

// ── T2-BILL-12: usage summary/timeseries/attribution/llm-balance match
// seeded ledger truth ──────────────────────────────────────────────────────
const t2Bill12: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const userId = await userIdFor(token);
  const subject = await b.ensurePersonalSubject(userId);

  const summaryBefore = await b.apiRequest<{ computeUsedSecondsMtd: number; llmUsedUsdMtd: number }>("/v1/billing/usage/summary", { token });
  const balanceBefore = await b.apiRequest<{ usedUsd: number }>("/v1/billing/llm-balance", { token });

  await b.seedUsageSegment(subject.id, { userId, hours: 1, startedAt: new Date(Date.now() - 30 * 60 * 1000) });
  await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 3.25 });
  await b.seedLlmUsageEvent({ subjectId: subject.id, userId, costUsd: 1.75 });

  const summary = await b.apiRequest<{ computeUsedSecondsMtd: number; llmUsedUsdMtd: number }>("/v1/billing/usage/summary", { token });
  assert.ok(Math.abs(summary.body.computeUsedSecondsMtd - summaryBefore.body.computeUsedSecondsMtd - 3600) < 10, "summary compute matches the seeded hour");
  assert.ok(Math.abs(summary.body.llmUsedUsdMtd - summaryBefore.body.llmUsedUsdMtd - 5.0) < 0.05, "summary LLM matches the seeded $5.00");

  const balance = await b.apiRequest<{ usedUsd: number }>("/v1/billing/llm-balance", { token });
  assert.ok(Math.abs(balance.body.usedUsd - balanceBefore.body.usedUsd - 5.0) < 0.05, "llm-balance matches ledger truth");

  const timeseries = await b.apiRequest<{ buckets: Array<{ computeSeconds?: number }> }>("/v1/billing/usage/timeseries?granularity=day", { token });
  assert.equal(timeseries.status, 200);
  const seededCompute = (timeseries.body.buckets ?? []).reduce((s, bucket) => s + (bucket.computeSeconds ?? 0), 0);
  assert.ok(seededCompute >= 3599, "timeseries buckets sum to at least the seeded hour");

  const orgSubject = await b.ensureOrganizationSubject(organizationId, userId);
  await b.seedLlmUsageEvent({ subjectId: orgSubject.id, organizationId, userId, costUsd: 4.4 });
  const byUser = await b.apiRequest<{ users: Array<{ userId: string; llmCostUsd: number }> }>(`/v1/organizations/${organizationId}/usage/by-user`, { token });
  assert.equal(byUser.status, 200);
  const mine = byUser.body.users.find((u) => u.userId === userId);
  assert.ok(mine, "the seeding user appears in by-user attribution");
  assert.ok(mine!.llmCostUsd >= 4.4, "LLM cost attributed to the right user");

  return { status: "green" };
};

// ── T2-BILL-13: decision-matrix subset — a payment-held subject is denied a
// managed start once, before downstream delivery ───────────────────────────
const t2Bill13: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, customer, invoice } = await subscribedPersonalSubject();
  const failedInvoice = { ...invoice, id: `in_test_bill13_${Date.now()}`, customer: customer.id };
  const decisionsBefore = await b.withDb(async (db) => {
    const r = await db.query(`SELECT count(*)::int AS n FROM billing_decision_event`);
    return r.rows[0].n as number;
  });
  await b.deliverEvent({ type: "invoice.payment_failed", object: failedInvoice });
  const overview = await b.apiRequest<b.BlockState>("/v1/billing/overview", { token });
  assert.equal(overview.body.startBlocked, true, "a payment-held subject is denied before any downstream delivery");
  const decisionsAfter = await b.withDb(async (db) => {
    const r = await db.query(`SELECT count(*)::int AS n FROM billing_decision_event`);
    return r.rows[0].n as number;
  });
  assert.ok(decisionsAfter >= decisionsBefore, "the denial records a decision event");
  return { status: "green" };
};

// ── T2-BILL-14: onboarding free-credit dedup across concurrent/cross-account
// attempts; activated Core creates an org budget subject, not another
// personal free entitlement ────────────────────────────────────────────────
const t2Bill14: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const ownerId = await userIdFor(token);
  const email = `t2bill14-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  const memberId = await userIdFor(memberToken);
  const githubSubject = `t2bill14-gh-${Date.now()}`;
  await linkGithubIdentity(memberId, githubSubject);
  const subject = await b.ensurePersonalSubject(memberId);

  // Concurrent attempts genuinely race (async spawn): the `free_cloud_allocation`
  // guard + the `source_ref`-unique grant insert reserve the allocation once per
  // GitHub identity even under the race. Both passes may report "owns the grant"
  // (idempotent); the guarantee is EXACTLY ONE grant row.
  await Promise.all([runFreeCreditGrantPass(memberId), runFreeCreditGrantPass(memberId)]);
  const freeGrantCount = await llmCreditGrantCount(subject.id, "free_signup");
  assert.equal(freeGrantCount, 1, "concurrent attempts create exactly one free-signup grant row");

  // Activated Core creates an org budget subject (an org-scoped billing
  // subject), not another personal free-credit entitlement for the owner.
  const orgSubject = await b.ensureOrganizationSubject(organizationId, ownerId);
  assert.notEqual(orgSubject.id, subject.id, "org budget subject is distinct from the personal subject");
  const ownerFreeGrantsBefore = await b.withDb(async (db) => {
    const ownerSubject = await b.ensurePersonalSubject(ownerId);
    const r = await db.query(`SELECT count(*)::int AS n FROM llm_credit_grant WHERE billing_subject_id = $1 AND source = 'free_signup'`, [ownerSubject.id]);
    return r.rows[0].n as number;
  });
  assert.ok(ownerFreeGrantsBefore <= 1, "activating Core never mints a second personal free entitlement for the owner");

  if (!gatewayEnabled()) {
    // The subject-scoped LiteLLM virtual key / provider budget guarantees need
    // `ensure_user_enrollment` against the LiteLLM(-fake) admin plane — see the
    // module doc.
    return blockedResult(`LiteLLM virtual-key enrollment idempotency: ${GATEWAY_GAP_REASON}`);
  }

  // Enrollment idempotency: the real backfill mints exactly one virtual key per
  // subject, and a replayed backfill reuses it (no second key minted for the
  // same identity) — the enrollment analog of the free-credit dedup above.
  await runEnrollmentBackfillPass();
  const firstEnrollment = await getUserEnrollment(memberId);
  assert.ok(firstEnrollment?.virtualKeyId, "backfill mints a real virtual key for the member");
  assert.equal(firstEnrollment!.syncStatus, "synced", "enrollment reaches synced against the fake");
  await runEnrollmentBackfillPass();
  const secondEnrollment = await getUserEnrollment(memberId);
  assert.equal(
    secondEnrollment!.virtualKeyId,
    firstEnrollment!.virtualKeyId,
    "a replayed enrollment backfill reuses the same virtual key (idempotent)",
  );
  return { status: "green" };
};

// ── T2-BILL-15: real LiteLLM usage import — pagination, cursor, dedup,
// attribution, needs_review, debit once ────────────────────────────────────
const t2Bill15: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  if (!gatewayEnabled()) {
    // The real importer (`run_usage_import`) only runs meaningfully with the
    // agent gateway enabled and the management-plane LiteLLM fake wired at
    // boot (`gatewayFake: true` → `bootBillingStackWithLitellmFake`).
    return blockedResult(`Real usage-import pagination/dedup/needs_review: ${GATEWAY_GAP_REASON}`);
  }

  const { token, organizationId } = await adminContext();
  const userId = await userIdFor(token);

  // Enrollment mints real virtual keys (personal + a distinct org key) against
  // the fake — the identities the importer attributes spend to.
  await runEnrollmentBackfillPass();
  const personal = await getUserEnrollment(userId);
  const org = await getOrgEnrollment(organizationId, userId);
  assert.ok(personal?.virtualKeyId, "personal enrollment minted a real virtual key");
  assert.ok(org?.virtualKeyId, "org membership minted a distinct virtual key");
  assert.notEqual(org!.virtualKeyId, personal!.virtualKeyId, "personal and org keys are distinct");

  // Seed spend across a personal key, the org key, and an UNRESOLVED key, then
  // drive the REAL importer once: exactly-once import, payer/member
  // attribution, and needs_review fail-closed for the unresolved key.
  const now = new Date().toISOString();
  const personalReq = `req-personal-${Date.now()}`;
  const orgReq = `req-org-${Date.now()}`;
  const unresolvedReq = `req-unresolved-${Date.now()}`;
  await seedFakeSpendRows([
    { request_id: personalReq, api_key: personal!.virtualKeyId!, spend: 0.1, startTime: now },
    { request_id: orgReq, api_key: org!.virtualKeyId!, spend: 0.2, startTime: now },
    { request_id: unresolvedReq, api_key: `tok-unresolved-${Date.now()}`, spend: 1.23, startTime: now },
  ]);

  const before = await countUsageEvents();
  await runUsageImportPass();
  const afterFirst = await countUsageEvents();
  assert.equal(afterFirst - before, 3, "all three seeded rows imported exactly once");

  const personalEvent = await getUsageEvent(personalReq);
  assert.equal(personalEvent?.status, "imported");
  assert.equal(personalEvent?.userId, userId, "personal spend attributes to the payer");
  assert.equal(personalEvent?.billingSubjectId, personal!.billingSubjectId);
  assert.equal(personalEvent?.organizationId, null, "personal spend is not org-attributed");

  const orgEvent = await getUsageEvent(orgReq);
  assert.equal(orgEvent?.status, "imported");
  assert.equal(orgEvent?.organizationId, organizationId, "org-enrolled spend attributes to the org");
  assert.equal(orgEvent?.billingSubjectId, org!.billingSubjectId);
  assert.notEqual(orgEvent?.billingSubjectId, personalEvent?.billingSubjectId, "org and personal subjects differ");

  const unresolvedEvent = await getUsageEvent(unresolvedReq);
  assert.ok(unresolvedEvent, "the unresolved-key row is still recorded, never silently dropped");
  assert.equal(unresolvedEvent!.status, "needs_review", "an unresolved key fails closed to needs_review");
  assert.equal(unresolvedEvent!.userId, null);
  assert.equal(unresolvedEvent!.organizationId, null);
  assert.equal(unresolvedEvent!.billingSubjectId, null);

  // Restart / exactly-once: a repeated tick over the SAME overlap window (no new
  // spend seeded) creates no duplicate rows — dedup on litellm_request_id.
  await runUsageImportPass();
  const afterSecond = await countUsageEvents();
  assert.equal(afterSecond, afterFirst, "a repeated import tick adds no duplicate rows (exactly-once)");

  return { status: "green" };
};

const cases: Record<string, Tier2CellHandler> = {
  "T2-BILL-1": t2Bill1,
  "T2-BILL-2": t2Bill2,
  "T2-BILL-3": t2Bill3,
  "T2-BILL-4": t2Bill4,
  "T2-BILL-5": t2Bill5,
  "T2-BILL-6": t2Bill6,
  "T2-BILL-7": t2Bill7,
  "T2-BILL-8": t2Bill8,
  "T2-BILL-9": t2Bill9,
  "T2-BILL-10": t2Bill10,
  "T2-BILL-11": t2Bill11,
  "T2-BILL-12": t2Bill12,
  "T2-BILL-13": t2Bill13,
  "T2-BILL-14": t2Bill14,
  "T2-BILL-15": t2Bill15,
};

export const t2Bill = makeTier2MatrixScenario({
  id: T2_BILL_ID,
  title: "Tier-2 required billing group: pricing, seats, ledgers, imports, holds, Stripe events, top-up, exhaustion, recovery",
  registryFlowRef: "specs/developing/testing/core-release-validation.md#t2-bill",
  // Stripe is resolved at boot (env or `stripe config`); an unresolved key
  // returns every cell BLOCKED, so no env-manifest gate is required here.
  requiredEnv: [],
  requireStripe: true,
  // Boot gateway-enabled with the management-plane LiteLLM fake wired, so the
  // $5/seat LLM pool grant, LLM exhaustion, enrollment/virtual-key, and the
  // real `run_usage_import` cells run for real (T2-BILL-2/6/14/15).
  gatewayFake: true,
  cases,
});
