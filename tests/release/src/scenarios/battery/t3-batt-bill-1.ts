import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { BillingHttpClient, resolveDurableOrgId, type OwnerSelection } from "../../fixtures/billing-http.js";
import { BATTERY_FLOW_REF, assertStagingLane, authenticateBattery } from "./common.js";

/**
 * T3-BATT-BILL-1 — the billing surfaces read coherently, live on staging.
 *
 * Journey: for both billing subjects the durable user has (personal, and the
 * durable org) the overview, usage summary, and LLM balance answer and agree
 * with each other. This is the read-only half of the billing ruling; the
 * lifecycle (fund → consume → exhaust → refill → overage) stays with
 * T3-BILL-3/4 and is deferred on staging for the reasons documented there.
 *
 * Outcomes asserted: overview carries a plan and billing mode · usage summary
 * is numeric · LLM balance is numeric and internally consistent
 * (granted − used = remaining, never negative remaining) · for both subjects.
 */
export const t3BattBill1: ScenarioDefinition = {
  id: "T3-BATT-BILL-1",
  title: "battery: billing overview / usage / LLM balance read coherently (personal + org)",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user; resolve the durable org" },
    { description: "for personal + org: GET overview, usage-summary, llm-balance" },
    { description: "assert each surface answers with coherent numbers (no negative balances, granted−used=remaining)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-BILL-1", ctx);
    const { serverUrl, session } = await authenticateBattery("T3-BATT-BILL-1", ctx);
    const billing = new BillingHttpClient(serverUrl, session.accessToken);

    const orgs = await billing.organizations();
    const orgId = resolveDurableOrgId(orgs, process.env.RELEASE_E2E_DURABLE_ORG_ID);
    if (!orgId) {
      throw new ScenarioBlockedError(
        `T3-BATT-BILL-1: could not resolve the durable org — set RELEASE_E2E_DURABLE_ORG_ID (found ${orgs.length} orgs).`,
      );
    }

    const subjects: Array<[string, OwnerSelection]> = [
      ["personal", { ownerScope: "personal" }],
      [`org ${orgId}`, { ownerScope: "organization", organizationId: orgId }],
    ];
    const lines: string[] = [];
    for (const [label, owner] of subjects) {
      const overview = await billing.overview(owner);
      assert.ok(overview.plan, `T3-BATT-BILL-1 (${label}): overview must name a plan`);
      assert.ok(overview.billingMode, `T3-BATT-BILL-1 (${label}): overview must name a billing mode`);

      const usage = await billing.usageSummary(owner);
      // Contract note: several usage fields are `float | None` server-side
      // (unlimited entitlements) — null is contract-legal, negative is not.
      for (const [key, value] of Object.entries({
        computeUsedSecondsMtd: usage.computeUsedSecondsMtd,
        computeRemainingSeconds: usage.computeRemainingSeconds,
        llmUsedUsdMtd: usage.llmUsedUsdMtd,
        llmRemainingUsd: usage.llmRemainingUsd,
      })) {
        if (value === null || value === undefined) {
          continue;
        }
        assert.equal(typeof value, "number", `T3-BATT-BILL-1 (${label}): usage.${key} must be numeric or null`);
        assert.ok(Number.isFinite(value) && value >= 0, `T3-BATT-BILL-1 (${label}): usage.${key} must be a non-negative number`);
      }

      const llm = await billing.llmBalance(owner);
      assert.ok(llm.remainingUsd >= 0, `T3-BATT-BILL-1 (${label}): LLM remaining must never be negative (got ${llm.remainingUsd})`);
      assert.ok(
        Math.abs(llm.grantedUsd - llm.usedUsd - llm.remainingUsd) < 0.01 || llm.remainingUsd === 0,
        `T3-BATT-BILL-1 (${label}): LLM balance must be coherent (granted ${llm.grantedUsd} − used ${llm.usedUsd} ≠ remaining ${llm.remainingUsd})`,
      );
      lines.push(
        `${label}: plan=${overview.plan} mode=${overview.billingMode} compute_remaining_s=${usage.computeRemainingSeconds} ` +
          `llm_remaining_usd=${llm.remainingUsd}`,
      );
    }

    console.log(`[T3-BATT-BILL-1/staging] green: ${lines.join(" · ")}`);
  },
};
