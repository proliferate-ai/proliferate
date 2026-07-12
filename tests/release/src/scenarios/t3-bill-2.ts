import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";

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
 * Safety posture: the old implementation zeroed every grant on the shared
 * durable user before discovering that the enforcement fixture was absent.
 * That is not the authoritative run-scoped billing world and can leave later
 * tests poisoned, so the destructive seam is removed. This scenario now
 * fails closed before mutation until the disposable funded/exhausted fixture
 * in core-release-validation.md exists. Blocked for the enforcement + sweep:
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
  // The legacy shared-account setup is deliberately disabled before any
  // external dependency is touched. The replacement scenario will declare
  // the run-scoped billing-world dependencies when that fixture lands.
  requiredEnv: [],
  plan: () => [
    { description: "SETUP: create a disposable correlation-owned funded subject; never mutate the shared durable user" },
    { description: "drive only that disposable subject to compute and managed-credit exhaustion" },
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
    throw new ScenarioBlockedError(
      "T3-BILL-2: unsafe legacy shared-account exhaustion is disabled. Implement the authoritative " +
        "run-scoped billing world (correlation-owned customer/subject/test clock, separate compute and " +
        "managed-credit exhausted states, deterministic teardown + TTL janitor) before enabling the real " +
        "bypass sweep. No grant or external billing state was mutated by this run.",
    );
  },
};
