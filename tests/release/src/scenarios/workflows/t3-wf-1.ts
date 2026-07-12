import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import {
  archiveWorkflow,
  createWorkflow,
  isApiError,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-1 — structured output + required tools (`wf-emit-gate`).
 * specs/developing/testing/scenarios.md#T3-WF-1
 *
 * Proves: the first emit attempt may fail the schema → a corrective reprompt
 * occurs → the validated output is persisted; and the required-invocation gate
 * blocks the step until the tool call happens. Assertions read the run row +
 * step-action ledger (`GET /v1/cloud/workflows/runs/{id}` returns both) and the
 * emitted `step_outputs` — never transcript text. `step_actions[].attemptCount`
 * is the re-ask evidence.
 *
 * Reality on this branch (verified 2026-07-10): the fixture grants the reserved
 * `functions` namespace for its `required_invocation`, and creating a workflow
 * that grants `functions` is REJECTED at save with `workflow_function_provider_
 * unknown` — the reserved namespace is never an integration-definition row, and
 * `_validate_workflow_functions` checks the grant against visible DEFINITION
 * namespaces. So this scenario cannot even create the fixture. That is the same
 * gap T3-WF-2 diagnoses in full; here it surfaces as an expected-fail with the
 * precise diagnosis. Once the functions grant path is wired, the emit-gate
 * assertions below become live (they need an executing agent: cloud sandbox or
 * the desktop executor, see the sandbox-lane note).
 */
export const t3Wf1: ScenarioDefinition = {
  id: "T3-WF-1",
  title: "structured output + required tools (emit gate)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [],
  requiredEnvByLane: {
    local: [
      "RELEASE_E2E_SERVER_URL",
      "RELEASE_E2E_DURABLE_USER_EMAIL",
      "RELEASE_E2E_DURABLE_USER_PASSWORD",
      "RELEASE_E2E_DURABLE_ORG_ID",
    ],
  },
  plan: () => [
    { description: "create the wf-emit-gate workflow (one agent: required_invocation gate + strict agent.emit)" },
    { description: "StartRun; poll the run to a terminal status" },
    { description: "assert the required-invocation gate step advanced only after the tool call (step_actions ledger)" },
    { description: "assert the emit step's attemptCount reflects any schema re-ask, and the validated output persisted to step_outputs" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-1/staging: deferred from the first staging pass — creating a workflow + run mutates the SHARED " +
          "durable user/org. Needs a dedicated non-shared staging fixture (same posture as T3-INT-1/staging).",
      );
    }
    if (ctx.runtimeLane === "sandbox") {
      throw new ScenarioExpectedFailError(
        "T3-WF-1/sandbox: the emit gate needs an executing agent. Cloud execution needs the in-sandbox delivery " +
          "path (real E2B sandbox + publicly reachable RELEASE_E2E_SERVER_URL) which the release runner does not " +
          "yet drive (shared with T3-CHAT-1/T3-INT-1, #1042).",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const definition = await readWorkflowFixture("wf-emit-gate");

    let workflowId: string | undefined;
    try {
      const created = await createWorkflow(client, definition, { nameSuffix: "wf1" });
      workflowId = created.workflow.id;
    } catch (error) {
      if (isApiError(error, "workflow_function_provider_unknown", "invalid_payload")) {
        throw new ScenarioExpectedFailError(
          "T3-WF-1: creating a workflow that grants the reserved `functions` namespace is rejected at save " +
            "(`workflow_function_provider_unknown`). The definition→run-scope grant path for function invocations " +
            "is unwired: `resolve_run_scope` only reads `integrations`, and `_validate_workflow_functions` checks it " +
            "against visible integration DEFINITION namespaces, which never include the reserved virtual `functions` " +
            "provider. See the T3-WF-2 diagnosis + the product-bug report. The emit-gate assertions cannot run until " +
            "a workflow can grant functions.",
        );
      }
      throw error;
    }

    try {
      // If save ever accepts the functions grant, exercise the gate for real.
      // Execution still needs an agent runner (cloud/desktop), so a local
      // StartRun with no workspace target reports the honest blocker.
      throw new ScenarioExpectedFailError(
        "T3-WF-1/local: workflow created, but executing the emit gate needs an agent runner — a local " +
          "target_mode=local run is delivered by the desktop executor (track 2a), which the release runner does " +
          "not stand up. The emit re-ask + required-invocation-gate assertions are gated on that executor or the " +
          "cloud sandbox path.",
      );
    } finally {
      if (workflowId) {
        await archiveWorkflow(client, workflowId);
      }
    }
  },
};

// A single deep assertion helper kept for when the executor path lands; unused
// today because the run never executes. Exported so it is not dead-stripped and
// documents the intended outcome-based assertions (never transcript text).
export function assertEmitGateOutcome(detail: {
  run: { status: string; stepOutputs: Record<string, unknown> | null };
  stepActions: Array<{ stepKey: string; actionKind: string; status: string; attemptCount: number }>;
}): void {
  assert.equal(detail.run.status, "completed", "T3-WF-1: run must complete");
  const emitAction = detail.stepActions.find((a) => a.actionKind.includes("emit"));
  assert.ok(emitAction, "T3-WF-1: an emit step-action must exist");
  assert.ok(emitAction.attemptCount >= 1, "T3-WF-1: emit attemptCount must be recorded");
  assert.ok(detail.run.stepOutputs && "verdict" in detail.run.stepOutputs, "T3-WF-1: validated emit output must persist");
}
