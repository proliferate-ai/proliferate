import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { ApiClient, ApiRequestError } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { runBillingProbe, type DrainGrantsResult, type MeterRecords } from "../fixtures/billing.js";

/**
 * T3-BILL-2 — exhaustion gates: compute and LLM independently, no bypasses.
 * specs/developing/testing/scenarios.md#T3-BILL-2
 *
 * Drive the org's credits to exhaustion (grant manipulation allowed as *setup*
 * — the enforcement under test is the real deployed gate), then assert:
 * - compute: running sandbox paused + inaccessible; new cloud sandbox/workspace
 *   creation blocked with the enumerated credits-exhausted kind;
 * - LLM: the gateway rejects the test key's completion with the enumerated
 *   budget error, surfaced in a live session as an enumerated error (not a hang).
 *
 * Then the bypass sweep — every alternate entry we know exists, each attempted
 * FOR REAL and required to be refused:
 *   1. resume the paused sandbox via a direct API call (POST /cloud-sandbox/wake), not the UI;
 *   2. reconnect via a session opened BEFORE exhaustion (stale handle);
 *   3. E2B-webhook race: force a created/resumed provider event while the hold
 *      is active → inline re-pause fires (webhook path, not the 15-min reconciler);
 *   4. LLM via a pre-exhaustion materialized key still on the sandbox disk —
 *      the disabled-key propagation must beat it (re-materialization path);
 *   5. start a workspace as a DIFFERENT member of the same exhausted org;
 *   6. trigger-driven work (workflow/automation) that would start a sandbox.
 * Then refill → sandbox resumable, gateway serves again, new workspaces allowed.
 *
 * The live start gate is `assert_cloud_sandbox_resume_allowed_for_owner`, now
 * (post-#1036, merged) wired into the service layer so BOTH `/cloud-sandbox/wake`
 * and `/cloud-sandbox/ensure` inherit it before staging a row (`authorize_sandbox_start`
 * remains dead code — assert against the wired gate, never the dead function).
 * Its owner-subject resolution is #1047's (org member → org subject), so a hold
 * on the org grant pool blocks the member's resume. T3-BILL-3 asserts this gate
 * live against staging (`--lane staging`); this local-lane scenario still needs
 * a funded-then-drained org to exercise it end to end.
 *
 * Reachable now (real): the exhaustion SETUP — `billing_probe.py drain-grants`
 * zeroes the durable user's grant seconds directly, and this scenario asserts
 * the drain landed. Blocked for the enforcement + sweep:
 * - every cloud route (wake, new workspace, other-member start, trigger start)
 *   is `github_link_required`-gated (PR #1023) and needs a real running sandbox;
 * - the LLM-side gateway rejection needs `RELEASE_E2E_GATEWAY_TEST_KEY` (unset)
 *   to have a key to reject and a materialized key to race against.
 */
export const t3Bill2: ScenarioDefinition = {
  id: "T3-BILL-2",
  title: "exhaustion gates — compute and LLM independently, no bypasses",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-BILL-2",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  plan: () => [
    { description: "SETUP: drain the durable user's grant seconds to zero (billing_probe.py drain-grants)" },
    { description: "assert the drain landed (no grant retains positive remaining_seconds)" },
    { description: "compute gate: running sandbox paused + inaccessible; new workspace creation → enumerated credits-exhausted" },
    { description: "LLM gate: gateway rejects the test key's completion with the enumerated budget error" },
    { description: "bypass 1: direct-API resume (POST /cloud-sandbox/wake) refused" },
    { description: "bypass 2: reconnect via a pre-exhaustion (stale) session refused" },
    { description: "bypass 3: E2B created/resumed webhook race → inline re-pause fires" },
    { description: "bypass 4: pre-exhaustion on-disk materialized key refused (disabled-key propagation)" },
    { description: "bypass 5: a different member of the exhausted org cannot start a workspace" },
    { description: "bypass 6: trigger-driven work cannot start a sandbox" },
    { description: "refill → sandbox resumable, gateway serves again, new workspaces allowed" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const email = ctx.env.require("RELEASE_E2E_DURABLE_USER_EMAIL");

    // Reachable real SETUP: force exhaustion, then confirm it landed.
    const drain = (await runBillingProbe("drain-grants", email)) as DrainGrantsResult;
    assert.equal(drain.error, undefined, `T3-BILL-2: drain-grants failed: ${drain.error}`);
    const after = (await runBillingProbe("meter-records", email, { sinceSeconds: 1 })) as MeterRecords;
    const positive = after.grants.filter((g) => g.remainingSeconds > 0);
    assert.equal(
      positive.length,
      0,
      `T3-BILL-2: after drain, no grant may retain positive remaining_seconds (found ${positive.length})`,
    );
    console.log(`[T3-BILL-2/sandbox] setup: drained ${drain.drained} grant(s); credits forced to exhaustion`);

    // If there were no grants to drain, the durable org is not enrolled in a
    // billing plan with drainable grant seconds, so there is no *enforceable*
    // exhausted state — #1045's `assert_cloud_sandbox_resume_allowed` 402 gate
    // only fires for an org whose enrolled grants were driven to zero. Verified
    // 2026-07-09: drain removed 0 grants and the direct-API wake returned
    // status=ready (200), not a 402. This is a billing-setup gap, not a missing
    // product gate — the gate cannot be exercised until the durable org has a
    // real (Stripe test-clock) subscription + grant to exhaust.
    if (drain.drained === 0 && after.grants.length === 0) {
      throw new ScenarioExpectedFailError(
        "T3-BILL-2: the durable org has no enrolled/drainable grants, so credits cannot be driven to an " +
          "enforceable exhausted state — #1045's direct-API-resume 402 gate (and the whole bypass sweep) " +
          "cannot be exercised. Verified 2026-07-09: drain removed 0 grants and POST /cloud-sandbox/wake " +
          "returned status=ready. Needs a Stripe test-clock subscription + grant on the durable org to run " +
          "for real; the #1036 pin (bypass 1 must 402 post-#1045) stays flipped and will assert once billing " +
          "setup exists.",
      );
    }

    // First real, gated enforcement probe: the direct-API resume bypass
    // (route 1). Reaching past this means the github_link gate lifted and the
    // real `assert_cloud_sandbox_resume_allowed` enforcement is now assertable;
    // the remaining routes (2-6), the LLM-side gateway rejection, and the
    // refill re-enable are intentionally not implemented beyond this first real
    // call — finish them against the live enumerated errors once reachable,
    // following the T3-PROV-2 / T3-SEC-MAT-1 convention.
    await withProductGate("T3-BILL-2", async () => {
      const durablePassword = ctx.env.require("RELEASE_E2E_DURABLE_USER_PASSWORD");
      const session = await loginDurableUser({ serverUrl, email, password: durablePassword, organizationId: "" });
      const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

      let refused = false;
      let observed: unknown;
      try {
        observed = await client.post("/v1/cloud/cloud-sandbox/wake", {});
      } catch (error) {
        // github_link_required rethrows out of here to withProductGate (blocked,
        // not red); a 402 credits-exhausted decision is the REAL refusal we want.
        if (error instanceof ApiRequestError && error.status === 402) {
          refused = true;
        } else {
          throw error;
        }
      }
      assert.ok(
        refused,
        `T3-BILL-2: bypass 1 (direct-API resume) must be refused with a 402 credits-exhausted decision ` +
          `while exhausted — instead got: ${JSON.stringify(observed)}`,
      );
      throw new Error(
        "T3-BILL-2: direct-API resume was refused as expected (gate lifted) but bypass routes 2-6, the " +
          "LLM-side gateway rejection, and the refill re-enable are not yet implemented — finish them " +
          "now that the gate is open, asserting each against its live enumerated error.",
      );
    });
  },
};
