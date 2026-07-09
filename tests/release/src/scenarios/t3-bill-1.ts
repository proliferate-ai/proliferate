import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import {
  ORG_COMPUTE_ATTRIBUTION_FIXED,
  expectedComputeSubjectKind,
  runBillingProbe,
  type MeterRecords,
} from "../fixtures/billing.js";

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
 * as-built: compute → the workspace owner's PERSONAL subject; LLM → the ORG
 * subject where enrolled (the org compute-attribution fix is #1028, tracked by
 * ORG_COMPUTE_ATTRIBUTION_FIXED — false on this branch).
 *
 * Reachable now (real, cheap): the ledger reader
 * (`tests/release/scripts/billing_probe.py`) reads the durable user's meter
 * records and grants directly from the profile DB, and this scenario asserts
 * the branch's compute-attribution *capability* (`usage_segment` has no
 * `organization_id` column until #1028) against ORG_COMPUTE_ATTRIBUTION_FIXED —
 * the "assert current behavior as-built" the contract requires.
 *
 * Blocked (per lane, reported not skipped) for PRODUCING new consumption:
 * - local lane / LLM half: no `RELEASE_E2E_GATEWAY_TEST_KEY` exists, so a local
 *   session uses native CLI login and emits zero gateway `agent_llm_usage_event`
 *   rows — there is nothing to meter. Blocked-on-credential.
 * - sandbox lane / compute half: `usage_segment` rows are opened/closed by real
 *   E2B webhooks, which require a running cloud sandbox (the durable user is
 *   `github_link_required`-gated off the cloud path, PR #1023) AND a publicly
 *   reachable server URL for E2B to deliver the created/resumed/paused webhooks
 *   to. Blocked on both.
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
    { description: "assert attribution: compute → personal subject; LLM → org subject where enrolled" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const email = ctx.env.require("RELEASE_E2E_DURABLE_USER_EMAIL");

    // Reachable real assertion: read the ledger and pin the branch's
    // compute-attribution capability against the flag.
    const meter = (await runBillingProbe("meter-records", email, { sinceSeconds: 3600 })) as MeterRecords;
    assert.equal(meter.error, undefined, `T3-BILL-1: meter probe failed: ${meter.error}`);
    assert.ok(meter.subjects.personal, "T3-BILL-1: durable user must have a personal billing subject");
    assert.equal(
      meter.usageSegmentHasOrgColumn,
      ORG_COMPUTE_ATTRIBUTION_FIXED,
      `T3-BILL-1: usage_segment.organization_id presence (${meter.usageSegmentHasOrgColumn}) must match ` +
        `ORG_COMPUTE_ATTRIBUTION_FIXED (${ORG_COMPUTE_ATTRIBUTION_FIXED}) — flip the flag when #1028 merges`,
    );
    console.log(
      `[T3-BILL-1/${ctx.runtimeLane}] baseline: ${meter.usageSegments.length} segment(s), ` +
        `${meter.llmUsageEvents.length} llm event(s), ${meter.grants.length} grant(s); ` +
        `compute bills the ${expectedComputeSubjectKind(ORG_COMPUTE_ATTRIBUTION_FIXED)} subject`,
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
        "webhooks, which need (1) a running cloud sandbox for the durable user (blocked on " +
        "github_link_required until PR #1023 merges; flip GITHUB_LINK_GATE_WORKAROUND_ACTIVE) and " +
        "(2) a publicly reachable RELEASE_E2E_SERVER_URL for E2B to deliver created/resumed/paused " +
        "webhooks to (the local profile is on 127.0.0.1; needs a tunnel).",
    );
  },
};
