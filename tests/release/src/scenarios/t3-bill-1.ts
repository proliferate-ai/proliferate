import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import { ORG_COMPUTE_ATTRIBUTION_FIXED, runBillingProbe, type MeterRecords } from "../fixtures/billing.js";

/**
 * T3-BILL-1 — real consumption is metered: LLM and compute.
 * specs/developing/testing/scenarios.md#T3-BILL-1
 *
 * The contract: a real agent session (reuse a T3-CHAT-1 run) plus a sandbox
 * kept running for a known interval must produce (a) `agent_llm_usage_event`
 * rows whose tokens/cost match the gateway's recorded usage for the test key,
 * with the credit balance decremented, and (b) a closed `usage_segment`
 * (opened/closed by the E2B webhooks, not a timer) with the accounting pass
 * draining the corresponding grant seconds. Attribution must be asserted
 * as-built. As of #1047 (merged) BOTH tracks attribute the same way: a user
 * with a current org membership bills the ORG subject (org Stripe customer,
 * org grant pool) for compute AND LLM; an org-less user bills personal. #1047
 * resolves the paying subject at segment-open from the same membership lookup
 * #1028 uses to stamp `usage_segment.organization_id`, so `billing_subject_id`
 * and `organization_id` can never disagree — the earlier "compute always bills
 * the workspace owner's personal subject" behavior is gone.
 * ORG_COMPUTE_ATTRIBUTION_FIXED tracks that org compute now bills the org
 * subject (#1028 column + #1047 who-pays) — true on this branch.
 *
 * Reachable now (real, cheap): the ledger reader
 * (`tests/release/scripts/billing_probe.py`) reads the durable user's meter
 * records and grants directly from the profile DB, and this scenario asserts
 * the branch's compute-attribution *capability* (`usage_segment` has an
 * `organization_id` column, per merged #1028) against
 * ORG_COMPUTE_ATTRIBUTION_FIXED, plus that any compute segment carrying an
 * `organization_id` invoices the org subject (not personal) per #1047 — the
 * "assert current behavior as-built" the contract requires.
 *
 * Blocked (per lane, reported not skipped) for PRODUCING new consumption:
 * - local lane / LLM half: no `RELEASE_E2E_GATEWAY_TEST_KEY` exists, so a local
 *   session uses native CLI login and emits zero gateway `agent_llm_usage_event`
 *   rows — there is nothing to meter. Blocked-on-credential.
 * - sandbox lane / compute half: `usage_segment` rows are opened/closed by real
 *   E2B webhooks, which require a running cloud sandbox for the durable user
 *   AND a publicly reachable server URL for E2B to deliver the
 *   created/resumed/paused webhooks to. Blocked on both (the
 *   `github_link_required` gate itself is cleared — PR #1023 merged and
 *   `GITHUB_LINK_GATE_WORKAROUND_ACTIVE` is already `false` on this branch).
 */
export const t3Bill1: ScenarioDefinition = {
  id: "T3-BILL-1",
  title: "real consumption is metered — LLM and compute",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-BILL-1",
  lanes: ["local", "sandbox"],
  requiredEnv: ["RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_LOCAL_DATABASE_URL"],
  plan: ({ runtimeLane }) => [
    { description: "read baseline meter records + grants for the durable user (billing_probe.py)" },
    {
      description:
        "assert compute-attribution capability matches ORG_COMPUTE_ATTRIBUTION_FIXED " +
        `(usage_segment.organization_id present iff fixed; currently ${ORG_COMPUTE_ATTRIBUTION_FIXED})`,
    },
    runtimeLane === "local"
      ? { description: "produce real LLM usage via a gateway-keyed session → assert agent_llm_usage_event rows + credit decrement (LLM half)" }
      : { description: "keep a real cloud sandbox running an interval → assert a closed usage_segment + grant drain (compute half)" },
    { description: "assert attribution (#1047): org-member compute + LLM → org subject; org-less user → personal" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const email = ctx.env.require("RELEASE_E2E_DURABLE_USER_EMAIL");

    // Reachable real assertion: read the ledger and pin the branch's
    // compute-attribution capability against the flag.
    const meter = (await runBillingProbe("meter-records", email, {
      sinceSeconds: 3600,
      organizationId: process.env.RELEASE_E2E_DURABLE_ORG_ID,
    })) as MeterRecords;
    assert.equal(meter.error, undefined, `T3-BILL-1: meter probe failed: ${meter.error}`);
    if (!meter.subjects.personal) {
      throw new ScenarioBlockedError(
        "T3-BILL-1: this profile has no initialized managed-cloud billing subject. A first-run self-host " +
          "claim intentionally creates only its user and instance organization; it is not a billing fixture. " +
          "Run this proof against the authoritative disposable managed-cloud billing world after its real " +
          "owner-scoped billing setup has materialized the correlation-owned personal/org subjects. No billing " +
          "state was mutated by this run.",
      );
    }
    assert.equal(
      meter.usageSegmentHasOrgColumn,
      ORG_COMPUTE_ATTRIBUTION_FIXED,
      `T3-BILL-1: usage_segment.organization_id presence (${meter.usageSegmentHasOrgColumn}) must match ` +
        `ORG_COMPUTE_ATTRIBUTION_FIXED (${ORG_COMPUTE_ATTRIBUTION_FIXED}) — #1028 is merged so this must be true`,
    );
    // #1047: org compute bills the ORG subject (org Stripe customer + org grant
    // pool), matching LLM. Assert it as-built rather than pinning the old
    // personal-subject behavior: any compute segment stamped with an
    // organization_id must be invoiced to the org's billing subject, never the
    // owner's personal subject.
    const orgSubjectId = meter.subjects.organization;
    const personalSubjectId = meter.subjects.personal;
    for (const segment of meter.usageSegments) {
      const org = segment.organizationId;
      if (!org) {
        continue; // org-less user's segment — stays personal, nothing to check
      }
      assert.notEqual(
        segment.billingSubjectId,
        personalSubjectId,
        `T3-BILL-1: #1047 — compute segment ${segment.id} carries organization_id ${org} but is invoiced ` +
          `to the owner's personal subject (${personalSubjectId}); it must bill the org subject`,
      );
      if (orgSubjectId) {
        assert.equal(
          segment.billingSubjectId,
          orgSubjectId,
          `T3-BILL-1: #1047 — org compute segment ${segment.id} must bill the org subject ${orgSubjectId}`,
        );
      }
    }
    console.log(
      `[T3-BILL-1/${ctx.runtimeLane}] baseline: ${meter.usageSegments.length} segment(s), ` +
        `${meter.llmUsageEvents.length} llm event(s), ${meter.grants.length} grant(s); ` +
        // #1047: org compute now bills the org subject (org grant pool),
        // matching LLM; org-less users still bill personal.
        `org-member compute + LLM bill the org subject`,
    );

    if (ctx.runtimeLane === "local") {
      throw new ScenarioBlockedError(
        "T3-BILL-1/local (LLM half): blocked on credential — RELEASE_E2E_GATEWAY_TEST_KEY is not set. " +
          "A local session uses native CLI login and emits no gateway agent_llm_usage_event rows, so " +
          "there is no metered LLM consumption to assert. Issue a LiteLLM virtual key for an e2e-tests " +
          "team (allowlisted to the cheap test-model set, see T3-CHAT-1) and add it as " +
          "RELEASE_E2E_GATEWAY_TEST_KEY, then route the session through the gateway with it.",
      );
    }
    throw new ScenarioBlockedError(
      "T3-BILL-1/sandbox (compute half): blocked — a closed usage_segment is opened/closed by real E2B " +
        "webhooks, which need (1) a running cloud sandbox for the durable user and " +
        "(2) a publicly reachable RELEASE_E2E_SERVER_URL for E2B to deliver created/resumed/paused " +
        "webhooks to (the local profile is on 127.0.0.1; needs a tunnel). The github_link_required gate " +
        "itself is cleared (PR #1023 merged, GITHUB_LINK_GATE_WORKAROUND_ACTIVE already false); the " +
        "remaining blocker for this lane is the sandbox + tunnel above.",
    );
  },
};
