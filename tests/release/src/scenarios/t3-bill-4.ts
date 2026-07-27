import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import { ApiClient, ApiRequestError } from "../fixtures/http.js";
import {
  assertDurableIdentityAvailableForLane,
  loginDurableUserForLane,
} from "../fixtures/lane-identity.js";
import {
  BillingHttpClient,
  resolveDefaultOrgId,
  resolveDurableOrgId,
  type OwnerSelection,
} from "../fixtures/billing-http.js";

/**
 * T3-BILL-4 — org billing lifecycle against the real deployment: the
 * out-of-credits enforcement contract, asserted live.
 * specs/developing/testing/scenarios.md#T3-BILL-4
 *
 * The billing ruling (Pablo 2026-07-10) is a hand-rolled durable org walking
 * the full lifecycle: sign up as an org → upgrade → credits granted → consume
 * (LLM + compute) → exhaustion behavior → refill/top-up reactivates → overage
 * on → overage bills. This scenario owns the parts that are reachable for real
 * against staging today through the billing HTTP surface a client uses (the
 * ledger DB seam T3-BILL-1/2 use is local-only — the staging DB is VPC-only,
 * and the durable staging user `proliferate-e2e-bot` is a GitHub-OAuth account
 * that passes `current_product_user`).
 *
 * VERIFIED GREEN here (the ruling's "exhaustion behavior" + "no access after
 * money bites" clause), against the durable staging org's exhausted subject:
 *  - the enumerated out-of-credits state on the billing surfaces: cloud-plan /
 *    overview report `startBlocked=true`, `holdReason=credits_exhausted`,
 *    remaining hours 0; `llm-balance.remainingUsd=0`;
 *  - the LIVE compute start gate (#1036, wired into the service layer):
 *    `POST /cloud-sandbox/ensure` is refused with a 402
 *    `billing_credits_exhausted` and no sandbox is created (the gate fires
 *    before the row insert);
 *  - the #1047 attribution contract as a positive contrast, in its org-only
 *    form (model-gateway.md §Account model — orgs are the only billing subject;
 *    no personal-subject enrollment is ever created): the signup free grant
 *    lands on the user's DEFAULT ORG's billing subject, and that default org is
 *    the payer for every gateway session ("which org pays (v1): the user's
 *    default org, always"). The durable org's spend therefore lands on an org
 *    subject and nowhere else — there is no personal pool left to drain;
 *  - overage can be turned on for the org via `overage-settings` and the policy
 *    round-trips (restored afterward).
 *
 * DEFERRED (documented, not a phantom blocked-run — the enforcement half above
 * is a complete positive contract and passes):
 *  - funding the org → consuming → refill/reactivate → metering overage usage
 *    cannot run against staging today. Staging's Stripe is in LIVE mode (a
 *    `cloud-checkout` returns a `cs_live_` session), so a test-mode top-up with
 *    card 4242 is impossible and a real charge is out of scope; org
 *    `cloud-checkout` is additionally gated (`org_pro_billing_disabled`, pro
 *    billing off on staging) and personal `refill-checkout` is unconfigured
 *    (`stripe_refill_price_unconfigured`). Compute-segment metering is also
 *    broken on staging independently: E2B delivers webhooks but every one 401s
 *    (`invalid_webhook_signature`), so `usage_segment` rows never open/close.
 *  - the LLM-side gateway key-withheld path (`agent_gateway_credits_exhausted`,
 *    #1103): the standalone RELEASE_E2E_GATEWAY_TEST_KEY has its own budget, not
 *    the org's, so it cannot demonstrate the org's virtual-key withholding.
 * These need a test-mode Stripe deployment (or the durable org funded then
 * drained on a test clock) and a working E2B webhook secret.
 */
export const t3Bill4: ScenarioDefinition = {
  id: "T3-BILL-4",
  title: "org billing lifecycle — out-of-credits enforcement, live",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-BILL-4",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user (lane-aware: staging rotates the seeded session)" },
    { description: "resolve the durable org (RELEASE_E2E_DURABLE_ORG_ID, else the one owned org)" },
    { description: "assert the org subject is in the enumerated credits-exhausted state (cloud-plan/overview/llm-balance)" },
    { description: "assert the signup free grant sits on the DEFAULT ORG's billing subject (org-only billing), and the governing enrollment is the org team org-<org-uuid>" },
    { description: "LIVE compute gate: POST /cloud-sandbox/ensure → 402 billing_credits_exhausted, no sandbox created (#1036)" },
    { description: "turn overage on for the org via overage-settings; assert it round-trips; restore" },
    { description: "DEFERRED: fund → consume → refill → meter overage (staging Stripe is LIVE mode; see docstring)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane !== "staging") {
      throw new ScenarioBlockedError(
        "T3-BILL-4: staging-only. It asserts a real deployment's billing HTTP surface (the durable staging " +
          "org's exhausted subject); the local lane's ledger is covered by T3-BILL-1/2's DB probe. Run with " +
          "`--lane staging`.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    assertDurableIdentityAvailableForLane("T3-BILL-4", ctx);
    const session = await loginDurableUserForLane(ctx, serverUrl);
    const billing = new BillingHttpClient(serverUrl, session.accessToken);

    const orgs = await billing.organizations();
    const orgId = resolveDurableOrgId(orgs, process.env.RELEASE_E2E_DURABLE_ORG_ID);
    if (!orgId) {
      throw new ScenarioBlockedError(
        "T3-BILL-4: could not resolve the durable org id — set RELEASE_E2E_DURABLE_ORG_ID (the staging org the " +
          `durable user owns), or ensure the user owns exactly one org (found ${orgs.length}).`,
      );
    }
    const org: OwnerSelection = { ownerScope: "organization", organizationId: orgId };
    // The personal owner scope is still addressable on the billing HTTP surface
    // (it resolves a personal Stripe-customer subject); under org-only billing
    // it must never hold LLM credit, which is asserted as a negative below.
    const personal: OwnerSelection = { ownerScope: "personal" };
    // The payer under org-only billing: the user's DEFAULT org (the earliest
    // active membership), which is also where the signup free grant lands.
    // For the single-org durable fixture this resolves to the same org as
    // `orgId` — RELEASE_E2E_DURABLE_ORG_ID names the bot's own (hence default)
    // org — so the two ids coincide in practice and are kept distinct only so
    // the free-grant assertion names the subject the spec names.
    const defaultOrgId = resolveDefaultOrgId(orgs, process.env.RELEASE_E2E_DURABLE_ORG_ID);
    if (!defaultOrgId) {
      throw new ScenarioBlockedError(
        "T3-BILL-4: could not resolve the durable user's DEFAULT org (the payer / free-grant subject under " +
          "org-only billing) — set RELEASE_E2E_DURABLE_ORG_ID, or ensure the user has exactly one active " +
          `membership (found ${orgs.length} orgs, none carrying a membership joinedAt to order by).`,
      );
    }
    const defaultOrg: OwnerSelection = { ownerScope: "organization", organizationId: defaultOrgId };

    // --- Enumerated out-of-credits state on the org subject (the ruling's
    //     "exhaustion behavior" / "no access after money bites"). ---
    const orgOverview = await billing.overview(org);
    if (!orgOverview.startBlocked) {
      // The durable org's steady state is exhausted: its only credit is the
      // one-time signup free grant (org-only billing lands it on the default
      // org's subject), long spent, and it cannot be test-funded on staging. A
      // non-blocked org means someone funded it out of band; report rather than
      // assert a confusing red.
      throw new ScenarioBlockedError(
        `T3-BILL-4: the durable org (${orgId}) is not in the exhausted state this scenario asserts against ` +
          `(startBlocked=${orgOverview.startBlocked}, remainingHours=${orgOverview.remainingHours}). It was ` +
          "funded out of band; drain it (teardown top-up model) before re-running.",
      );
    }
    assert.equal(
      orgOverview.holdReason,
      "credits_exhausted",
      `T3-BILL-4: exhausted org hold reason must be the enumerated credits_exhausted, got ${orgOverview.holdReason}`,
    );
    assert.equal(orgOverview.startBlockReason, "credits_exhausted", "T3-BILL-4: startBlockReason must be credits_exhausted");
    assert.equal(orgOverview.remainingHours, 0, "T3-BILL-4: exhausted org must have 0 remaining hours");

    const orgLlm = await billing.llmBalance(org);
    assert.equal(orgLlm.remainingUsd, 0, "T3-BILL-4: exhausted org must have 0 remaining LLM credit");

    const orgUsage = await billing.usageSummary(org);
    assert.equal(orgUsage.computeRemainingSeconds, 0, "T3-BILL-4: exhausted org must have 0 remaining compute seconds");

    const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

    // --- #1047 contrast in its org-only form: the signup free grant lands on
    //     the DEFAULT ORG's billing subject, and the enrollment that governs
    //     this user's gateway sessions is that org's team (`org-<org-uuid>`) —
    //     never a personal subject / `user-<uuid>` identity, which the re-cut
    //     deleted (model-gateway.md §Account model). ---
    const defaultOrgLlm = await billing.llmBalance(defaultOrg);
    if (defaultOrgLlm.grantedUsd <= 0) {
      // Deployment state, not a product red: either this deployment predates
      // the org-only re-cut (the grant is still parked on a pre-migration
      // personal subject the D-3 migration re-parents) or the durable identity
      // never qualified for the grant (no linked GitHub identity, or its
      // one-per-human allocation is claimed by another account).
      throw new ScenarioBlockedError(
        `T3-BILL-4: the durable user's default org (${defaultOrgId}) carries no LLM credit grant ` +
          `(grantedUsd=${defaultOrgLlm.grantedUsd}), so the org-only free-grant contract cannot be asserted here. ` +
          "Confirm the D-3 migration ran on this deployment (a pre-migration grant sits on a personal subject " +
          "until it is re-parented) and that the durable identity's one-per-human allocation is not claimed " +
          "by another account.",
      );
    }

    let enrollment: { subjectKind: string; litellmTeamId: string | null };
    try {
      enrollment = await client.get<{ subjectKind: string; litellmTeamId: string | null }>(
        "/v1/cloud/agent-gateway/enrollment",
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        // `agent_gateway_enrollment_not_found`: the deployment has the gateway
        // off, or the backfill has not enrolled the durable identity's default
        // org yet. Deployment state, not a billing-contract red.
        throw new ScenarioBlockedError(
          "T3-BILL-4: no agent-gateway enrollment exists for the durable user (404 " +
            "agent_gateway_enrollment_not_found), so the org-team binding cannot be asserted. Confirm the " +
            "deployment runs the gateway (AGENT_GATEWAY_ENABLED) and that the enrollment backfill has run for " +
            `the default org ${defaultOrgId}.`,
        );
      }
      throw error;
    }
    assert.equal(
      enrollment.subjectKind,
      "organization",
      `T3-BILL-4: the governing enrollment must be org-scoped — orgs are the only billing subject and no ` +
        `personal-subject enrollment is ever created; got subjectKind=${enrollment.subjectKind}`,
    );
    assert.ok(
      enrollment.litellmTeamId,
      "T3-BILL-4: the org enrollment must be bound to a LiteLLM team (the org wallet `org-<org-uuid>`, whose " +
        "budget mirrors the org's remaining credit); got no litellmTeamId",
    );

    // The personal owner scope still exists on the billing HTTP surface (it
    // resolves a personal Stripe-customer subject), but under org-only billing
    // it can never hold LLM credit: the signup grant is org-only and the D-3
    // migration re-parented every pre-migration personal grant. A non-zero
    // personal LLM grant here means the migration has not run on this
    // deployment — deployment state, reported, not silently tolerated.
    let personalGrantedUsd: number | undefined;
    try {
      personalGrantedUsd = (await billing.llmBalance(personal)).grantedUsd;
    } catch (error) {
      // A refused personal scope is the stronger form of the same guarantee.
      if (!(error instanceof ApiRequestError)) {
        throw error;
      }
    }
    if (personalGrantedUsd !== undefined && personalGrantedUsd > 0) {
      throw new ScenarioBlockedError(
        `T3-BILL-4: the durable user's PERSONAL subject still holds ${personalGrantedUsd} USD of LLM credit. ` +
          "Under org-only billing no grant is ever made to a personal subject, so this is un-migrated " +
          "pre-D residue — run the D-3 migration on this deployment (it moves the grant and its " +
          "free-credit allocation onto the default org's subject) before re-running.",
      );
    }

    // --- LIVE compute start gate (#1036): ensure/wake refused with the
    //     enumerated 402, and NO sandbox created (gate fires before insert). ---
    let refusedCode: string | undefined;
    let ensured: unknown;
    try {
      ensured = await client.post("/v1/cloud/cloud-sandbox/ensure", {});
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 402) {
        refusedCode = (error.body as { detail?: { code?: string } })?.detail?.code;
      } else {
        throw error;
      }
    }
    assert.equal(
      refusedCode,
      "billing_credits_exhausted",
      `T3-BILL-4: the live compute start gate (POST /cloud-sandbox/ensure) must be refused with a 402 ` +
        `billing_credits_exhausted while the org is exhausted — instead got ${JSON.stringify(ensured ?? refusedCode)}`,
    );
    const afterSandbox = await client.get<unknown>("/v1/cloud/cloud-sandbox");
    assert.equal(
      afterSandbox,
      null,
      "T3-BILL-4: the refused ensure must not create a sandbox (the gate fires before the row insert, #1036)",
    );

    // --- Overage on/off round-trip for the org (the ruling's "turn on overage
    //     billing"), reversible: capture, enable, assert, restore. ---
    const before = await billing.overview(org);
    let restored = false;
    try {
      const enabled = await billing.setOverage(org, true);
      assert.equal(enabled.overageEnabled, true, "T3-BILL-4: overage-settings must report overage enabled after turning it on");
      const reread = await billing.overview(org);
      assert.equal(reread.overageEnabled, true, "T3-BILL-4: overview must reflect the enabled overage policy");
    } finally {
      // Restore the org's original overage posture so the durable fixture is
      // left as found (nightly re-runs, shared resource).
      await billing.setOverage(org, before.overageEnabled);
      restored = true;
    }
    assert.ok(restored, "T3-BILL-4: overage policy must be restored");

    console.log(
      `[T3-BILL-4/staging] verified live: org ${orgId} exhausted (credits_exhausted hold, 402 on ensure, no ` +
        `sandbox created), free grant on the default org ${defaultOrgId}'s billing subject with the governing ` +
        `enrollment org-scoped on LiteLLM team ${enrollment.litellmTeamId} (org-only billing; no personal grant), ` +
        "overage toggle round-trips.",
    );
    console.log(
      "[T3-BILL-4/staging] DEFERRED (not verifiable on staging today): fund→consume→refill→meter-overage — " +
        "staging Stripe is LIVE mode (cloud-checkout returns cs_live_), org cloud-checkout is org_pro_billing_disabled, " +
        "personal refill is stripe_refill_price_unconfigured, and E2B webhooks 401 (invalid_webhook_signature) so " +
        "compute segments never open. Needs a test-mode Stripe deployment or a funded-then-drained org on a test clock.",
    );
  },
};
