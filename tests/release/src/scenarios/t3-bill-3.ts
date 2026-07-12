import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import {
  assertDurableIdentityAvailableForLane,
  loginDurableUserForLane,
} from "../fixtures/lane-identity.js";
import {
  BillingHttpClient,
  isStripeLiveModeUrl,
  isStripeTestModeUrl,
  resolveDurableOrgId,
  type OwnerSelection,
} from "../fixtures/billing-http.js";

/**
 * T3-BILL-3 — the funded billing lifecycle against the real deployment, and
 * the proof that staging now runs Stripe in TEST mode.
 * specs/developing/testing/scenarios.md#T3-BILL-3
 *
 * Context (2026-07-09): staging was swapped from a `sk_live_` Stripe key to the
 * account's test mode — the exact blocker finding #4 recorded (a `cloud-checkout`
 * used to return a `cs_live_` session, so the durable org could not be funded
 * without a real charge). With test mode wired (test price/meter ids,
 * `PRO_BILLING_ENABLED=true`, a test-mode webhook endpoint at the billing
 * webhook URL), the durable org was funded through a Stripe test subscription
 * (card 4242) — the same customer.subscription.created / invoice.paid webhooks
 * a real checkout fires — and credits landed. This scenario asserts, live
 * against `--lane staging`, the half of the ruling that is reachable this way:
 *
 * VERIFIED GREEN (the ruling's "fund → credits granted" + test-mode posture):
 *  - Pro billing is enabled on the deployment (`proBillingEnabled=true`) — the
 *    `org_pro_billing_disabled` gate finding #4 recorded is cleared;
 *  - a billing checkout/portal action returns a Stripe TEST-mode URL and never
 *    a live one — the deployment's Stripe is in test mode (finding #4 retired);
 *  - the durable org is funded: paid cloud, payment healthy, not start-blocked,
 *    with remaining compute credit — the fund → credits-granted contract;
 *  - overage can be turned on for the funded org via `overage-settings` and the
 *    policy round-trips (restored afterwards).
 *
 * DEFERRED (documented, not a phantom pass — asserting these needs machinery
 * that is not reachable from a nightly release run today):
 *  - the metered-overage AMOUNTS (seconds consumed → cents exported → Stripe
 *    event totals). Compute segments still never open on staging: E2B webhooks
 *    to `POST /api/v1/cloud/webhooks/e2b` all 401 (`invalid_webhook_signature`,
 *    finding #5 — unresolved as of 2026-07-09), so no `usage_segment` closes and
 *    no `proliferate_managed_cloud_overage_cents` meter event is emitted.
 *  - the LLM auto-top-up charge / fail-closed path. Driving the org's LLM
 *    balance below the top-up threshold needs the org's own gateway virtual key
 *    consumed for real; the standalone RELEASE_E2E_GATEWAY_TEST_KEY has its own
 *    budget, not the org's (same limitation t3-bill-4 records).
 * Tier-2 T2-BILL-* proves the metered-amount arithmetic against Stripe test
 * clocks per-PR; this scenario proves the deployed test-mode funded posture.
 *
 * Note (durable-org tension): this scenario asserts the org FUNDED, while
 * T3-BILL-4 asserts it EXHAUSTED — one durable org cannot satisfy both at once.
 * The billing ruling gives the funded half to T3-BILL-3; while the org is
 * funded, T3-BILL-4 reports blocked (its own "funded out of band" guard), not
 * red.
 */
export const t3Bill3: ScenarioDefinition = {
  id: "T3-BILL-3",
  title: "funded billing lifecycle + test-mode deployment, live",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-BILL-3",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ],
  plan: () => [
    { description: "authenticate the durable user (lane-aware: staging rotates the seeded session)" },
    { description: "resolve the durable org (RELEASE_E2E_DURABLE_ORG_ID, else the one owned org)" },
    { description: "assert Pro billing is enabled on the deployment (org_pro_billing gate cleared)" },
    { description: "assert a billing checkout/portal action returns a TEST-mode Stripe URL, never live (finding #4)" },
    { description: "assert the org is funded: paid cloud, payment healthy, not blocked, remaining compute credit" },
    { description: "turn overage on for the funded org via overage-settings; assert it round-trips; restore" },
    { description: "DEFERRED: metered overage AMOUNTS (E2B webhooks 401, finding #5) + LLM auto-top-up (org key)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane !== "staging") {
      throw new ScenarioBlockedError(
        "T3-BILL-3: staging-only. It asserts the real deployment's funded billing surface and that its Stripe " +
          "runs in test mode (the durable staging org's test subscription); the local lane's ledger is covered by " +
          "T3-BILL-1/2's DB probe. Run with `--lane staging`.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    assertDurableIdentityAvailableForLane("T3-BILL-3", ctx);
    const session = await loginDurableUserForLane(ctx, serverUrl);
    const billing = new BillingHttpClient(serverUrl, session.accessToken);

    const orgs = await billing.organizations();
    const orgId = resolveDurableOrgId(orgs, process.env.RELEASE_E2E_DURABLE_ORG_ID);
    if (!orgId) {
      throw new ScenarioBlockedError(
        "T3-BILL-3: could not resolve the durable org id — set RELEASE_E2E_DURABLE_ORG_ID (the staging org the " +
          `durable user owns), or ensure the user owns exactly one org (found ${orgs.length}).`,
      );
    }
    const org: OwnerSelection = { ownerScope: "organization", organizationId: orgId };

    // --- Pro billing gate cleared (finding #4's org_pro_billing_disabled). ---
    const overview = await billing.overview(org);
    assert.equal(
      overview.proBillingEnabled,
      true,
      "T3-BILL-3: Pro billing must be enabled on the deployment (finding #4 org_pro_billing_disabled gate cleared)",
    );

    // --- The deployment's Stripe is in TEST mode (finding #4's cs_live_). A
    //     subscribed org's cloud-checkout redirects to the customer portal, so
    //     accept either a cs_test_ Checkout Session or a test-mode portal URL;
    //     the load-bearing assertion is that it is never a LIVE-mode URL. ---
    const { url } = await billing.cloudCheckout(org);
    assert.equal(
      isStripeLiveModeUrl(url),
      false,
      `T3-BILL-3: the deployment must not mint LIVE-mode Stripe URLs (finding #4: staging was cs_live_). Got ${url}`,
    );
    assert.equal(
      isStripeTestModeUrl(url),
      true,
      `T3-BILL-3: the deployment's Stripe must be in test mode (cs_test_ / test-mode portal). Got ${url}`,
    );

    // --- Funded contract: fund → credits granted. The durable org carries a
    //     Stripe test subscription; a fresh nightly should find it funded. If
    //     it is not, report blocked (funding needs the out-of-band test
    //     subscription — no self-serve checkout completion from a headless
    //     nightly run) rather than a confusing red. ---
    if (!overview.isPaidCloud || overview.startBlocked || overview.remainingHours <= 0) {
      throw new ScenarioBlockedError(
        `T3-BILL-3: the durable org (${orgId}) is not in the funded state this scenario asserts ` +
          `(isPaidCloud=${overview.isPaidCloud}, startBlocked=${overview.startBlocked}, ` +
          `remainingHours=${overview.remainingHours}). Its Stripe test subscription lapsed or was drained; ` +
          "re-fund it (a test-mode cloud subscription on the org's Stripe customer) before re-running.",
      );
    }
    assert.equal(overview.paymentHealthy, true, "T3-BILL-3: a funded org must report paymentHealthy");
    assert.equal(overview.holdReason, null, "T3-BILL-3: a funded org must carry no spend hold");
    assert.ok(
      overview.remainingHours > 0,
      `T3-BILL-3: a funded org must have remaining cloud hours, got ${overview.remainingHours}`,
    );

    const usage = await billing.usageSummary(org);
    assert.ok(
      usage.computeRemainingSeconds > 0,
      `T3-BILL-3: a funded org must have remaining compute seconds, got ${usage.computeRemainingSeconds}`,
    );

    // --- Overage on/off round-trip for the funded org (reversible). ---
    const before = await billing.overview(org);
    try {
      const enabled = await billing.setOverage(org, true);
      assert.equal(enabled.overageEnabled, true, "T3-BILL-3: overage-settings must report overage enabled after turning it on");
      const reread = await billing.overview(org);
      assert.equal(reread.overageEnabled, true, "T3-BILL-3: overview must reflect the enabled overage policy");
    } finally {
      // Leave the org's overage posture as found (nightly re-runs, shared resource).
      await billing.setOverage(org, before.overageEnabled);
    }

    console.log(
      `[T3-BILL-3/staging] verified live: deployment Stripe is TEST mode (proBillingEnabled, non-live checkout URL), ` +
        `org ${orgId} funded (paid cloud, ${overview.remainingHours}h remaining, payment healthy), overage toggle round-trips.`,
    );
    console.log(
      "[T3-BILL-3/staging] DEFERRED (not verifiable on staging today): the metered-overage AMOUNTS — E2B webhooks " +
        "still 401 (invalid_webhook_signature, finding #5) so usage_segment rows never open and no overage meter " +
        "event is emitted — and the LLM auto-top-up charge, which needs the org's own gateway key consumed. Tier-2 " +
        "T2-BILL-* proves the metered arithmetic against Stripe test clocks.",
    );
  },
};
