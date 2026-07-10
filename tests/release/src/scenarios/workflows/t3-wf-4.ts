import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import {
  archiveWorkflow,
  createWorkflow,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-4 — parallel + sequential lanes (L30) (`wf-parallel-review`).
 * specs/developing/testing/scenarios.md#T3-WF-4
 *
 * Contract: per-lane step rows advance independently; lane-qualified keys in
 * outputs/ledger; the join waits for both lanes; the block's output is
 * referenceable only after the join. A parallel group forces worktree isolation
 * and a cloud target (`has_parallel_groups` rejects local targets + session
 * bindings), so this is a sandbox-lane scenario.
 *
 * Runs for real on save: the parallel definition (2 sequential slots bracketing a
 * 2-lane parallel block) round-trips through create + read. Per-lane execution
 * (independent advance, lane-qualified `<node>.<lane>.<step>` keys, join gating)
 * needs a real cloud sandbox + a publicly reachable server URL, which the runner
 * does not yet drive.
 */
export const t3Wf4: ScenarioDefinition = {
  id: "T3-WF-4",
  title: "parallel + sequential lanes (L30)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-4",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "create wf-parallel-review (intake → parallel[review_a, review_b] → summarize)" },
    { description: "assert the parallel definition round-trips through create + read" },
    { description: "StartRun (personal_cloud); assert per-lane step rows advance independently with lane-qualified keys" },
    { description: "assert the join waits for both lanes and the block output is referenceable only after the join" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-4/staging: deferred — creates a workflow/run against the SHARED durable user/org. Needs a " +
          "dedicated non-shared staging fixture (same posture as T3-INT-1/staging).",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const definition = await readWorkflowFixture("wf-parallel-review");

    const created = await createWorkflow(client, definition, { nameSuffix: "wf4" });
    try {
      // Real assertion: the parallel group round-trips through the definition
      // validator + storage (byte-identical canonical shape, no version bump).
      const version = created.currentVersion;
      assert.ok(version, "T3-WF-4: created workflow must have a current version");
      const agents = (version.definition.agents ?? []) as Array<Record<string, unknown>>;
      const parallelEntry = agents.find((entry) => Array.isArray((entry as { parallel?: unknown }).parallel));
      assert.ok(parallelEntry, "T3-WF-4: the stored definition must retain the parallel group");
      const lanes = (parallelEntry as { parallel: Array<{ slot: string }> }).parallel;
      assert.equal(lanes.length, 2, "T3-WF-4: the parallel group must have exactly 2 lanes");
      assert.deepEqual(
        lanes.map((l) => l.slot).sort(),
        ["review_a", "review_b"],
        "T3-WF-4: the two lanes must be review_a and review_b",
      );

      throw new ScenarioExpectedFailError(
        "T3-WF-4: the parallel definition round-tripped for real (2 lanes retained). Per-lane execution — " +
          "independent advance, lane-qualified `<node>.<lane>.<step>` step keys, join gating, block output " +
          "referenceable only after the join — needs a real E2B cloud sandbox (parallel forces worktree isolation " +
          "+ cloud target) and a publicly reachable RELEASE_E2E_SERVER_URL, which the runner does not yet drive (#1042).",
      );
    } finally {
      await archiveWorkflow(client, created.workflow.id);
    }
  },
};
