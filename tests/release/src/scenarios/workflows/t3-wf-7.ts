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
 * T3-WF-7 — automations (desktop) (`wf-schedule-cloud`, target_mode local).
 * specs/developing/testing/scenarios.md#T3-WF-7
 *
 * Contract: desktop claim → execute → relay → terminal. Shares the schedule
 * fixture with T3-WF-6; the target mode is `local` at trigger time. LOCAL lane
 * ONLY — a real desktop executor (the track-2a claim poll + heartbeat + relay)
 * drives it. There is no headless desktop lane, so this is NOT a CI gate: guarded
 * to report blocked under CI (recorded limitation). It MUST be runnable on a dev
 * machine with the desktop executor running.
 *
 * Runs for real on save: create the workflow + a `local` schedule trigger and
 * assert next_run_at. The claim→execute→relay→terminal proof needs a running
 * desktop executor holding a live claim, which the runner cannot stand up itself.
 */
export const t3Wf7: ScenarioDefinition = {
  id: "T3-WF-7",
  title: "automations (desktop) — local schedule trigger",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-7",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "[local dev-profile only] create wf-schedule-cloud + a 1-minute schedule trigger (target_mode local)" },
    { description: "assert next_run_at is stamped" },
    { description: "a running desktop executor claims the scheduled local run (10s claim poll + 30s heartbeat)" },
    { description: "assert claim → execute → relay (/status, /delivered) → terminal status" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-7/staging: the desktop executor lane is local dev-profile only — there is no staging desktop.",
      );
    }
    // Recorded limitation: no headless desktop lane exists. Under CI (or a
    // sandbox runtime) there is no dev-profile desktop app to claim + relay the
    // run, so this reports blocked rather than red.
    if (ctx.runtimeLane === "sandbox" || isCi()) {
      throw new ScenarioBlockedError(
        "T3-WF-7: no headless desktop lane exists. The desktop-executor claim→execute→relay path needs the dev " +
          "desktop app running; it is not a CI gate until a headless desktop lane is built. Run it locally with " +
          "the desktop executor up.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const definition = await readWorkflowFixture("wf-schedule-cloud");
    const created = await createWorkflow(client, definition, { nameSuffix: "wf7" });

    try {
      let trigger;
      try {
        trigger = await createTrigger(client, created.workflow.id, {
          kind: "schedule",
          concurrencyPolicy: "queue",
          missedRunPolicy: "run_latest",
          targetMode: "local",
          repoFullName: process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? "proliferate-e2e/e2e-fixture",
          schedule: { rrule: "FREQ=MINUTELY;INTERVAL=1", timezone: "UTC" },
        });
      } catch (error) {
        if (error instanceof ApiRequestError) {
          throw new ScenarioExpectedFailError(
            `T3-WF-7: local schedule-trigger create failed (${error.status}) — a schedule trigger still derives a ` +
              "workspace from a repo pin (D16), needing a configured cloud repo environment. The desktop " +
              "claim→execute→relay proof is gated on that + a running desktop executor.",
          );
        }
        throw error;
      }

      assert.equal(trigger.targetMode, "local", "T3-WF-7: trigger target_mode must be local (desktop)");
      assert.ok(trigger.nextRunAt, "T3-WF-7: schedule trigger must stamp next_run_at");
      console.log(`[T3-WF-7] local schedule trigger created; next_run_at=${trigger.nextRunAt}.`);

      throw new ScenarioExpectedFailError(
        "T3-WF-7: local schedule trigger created + next_run_at stamped. The desktop claim→execute→relay→terminal " +
          "proof needs a running desktop executor (track-2a claim poll/heartbeat/relay) holding a live claim on " +
          "the scheduled local run; the runner cannot stand up the desktop app itself. Run with the dev desktop up.",
      );
    } finally {
      await archiveWorkflow(client, created.workflow.id);
    }
  },
};

function isCi(): boolean {
  return process.env.CI === "true" || process.env.CI === "1";
}
