import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import { ApiRequestError } from "../../fixtures/http.js";
import {
  archiveWorkflow,
  createTrigger,
  createWorkflow,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-6 — automations (cloud) (`wf-schedule-cloud`).
 * specs/developing/testing/scenarios.md#T3-WF-6
 *
 * Contract: a 1-minute schedule trigger fires within budget; `scheduled_for` /
 * `started_at` are stamped; concurrency=queue backlog drains FIFO; the missed-run
 * `run_latest` policy is verified by suspending the beat one tick.
 *
 * Runs for real on save: create the workflow + a 1-minute schedule trigger and
 * assert its `next_run_at` is stamped. The firing/queue/missed-run halves need
 * the scheduler beat + a real cloud sandbox (personal_cloud target) + a publicly
 * reachable server URL, which the runner does not yet drive.
 */
export const t3Wf6: ScenarioDefinition = {
  id: "T3-WF-6",
  title: "automations (cloud) — schedule trigger",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-6",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "create wf-schedule-cloud + a 1-minute schedule trigger (personal_cloud, concurrency=queue, run_latest)" },
    { description: "assert the trigger's next_run_at is stamped (schedule resolved)" },
    { description: "wait for the beat to fire a run within budget; assert scheduled_for + started_at stamped" },
    { description: "assert concurrency=queue drains FIFO; suspend the beat one tick and assert missed-run run_latest" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-6/staging: deferred — a live 1-minute schedule fires real runs against the SHARED durable user/org " +
          "on the staging beat. Needs a dedicated non-shared staging fixture + a bounded run budget.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const definition = await readWorkflowFixture("wf-schedule-cloud");
    const created = await createWorkflow(client, definition, { nameSuffix: "wf6" });

    try {
      let trigger;
      try {
        trigger = await createTrigger(client, created.workflow.id, {
          kind: "schedule",
          concurrencyPolicy: "queue",
          missedRunPolicy: "run_latest",
          targetMode: "personal_cloud",
          repoFullName: process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? "proliferate-e2e/e2e-fixture",
          schedule: { rrule: "FREQ=MINUTELY;INTERVAL=1", timezone: "UTC" },
        });
      } catch (error) {
        if (error instanceof ApiRequestError) {
          throw new ScenarioExpectedFailError(
            `T3-WF-6: schedule-trigger create failed (${error.status}) — a schedule trigger derives its cloud ` +
              "workspace from a repo pin (D16), which needs a configured cloud repo environment for the durable " +
              "user. The fire-within-budget + queue-FIFO + missed-run assertions are gated on that + the scheduler beat.",
          );
        }
        throw error;
      }

      assert.equal(trigger.kind, "schedule", "T3-WF-6: trigger must be a schedule trigger");
      assert.ok(trigger.nextRunAt, "T3-WF-6: schedule trigger must stamp next_run_at (schedule resolved)");
      console.log(`[T3-WF-6] schedule trigger created; next_run_at=${trigger.nextRunAt}.`);

      throw new ScenarioExpectedFailError(
        "T3-WF-6: schedule trigger created + next_run_at stamped for real. Fire-within-budget (scheduled_for/" +
          "started_at), concurrency=queue FIFO drain, and missed-run run_latest (suspend the beat one tick) need " +
          "the scheduler beat to fire real personal_cloud runs into a real E2B sandbox with a publicly reachable " +
          "server URL, which the runner does not yet drive (#1042).",
      );
    } finally {
      await archiveWorkflow(client, created.workflow.id);
    }
  },
};
