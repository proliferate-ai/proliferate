import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import type { ApiClient } from "../../fixtures/http.js";
import {
  isBillingCreditsExhaustedError,
  probeAgentsThroughGateway,
  warmPersonalCloudSandbox,
} from "../../fixtures/cloud-sandbox.js";
import { findTurnEndedEvent, type SessionEventEnvelope } from "../../fixtures/local-runtime.js";
import { ApiRequestError } from "../../fixtures/http.js";
import {
  BATTERY_FLOW_REF,
  assertStagingLane,
  authenticateBattery,
  cheapestModel,
  describeFailure,
  errorCode,
  isSurfaceAbsent,
} from "./common.js";

/** The server's real proxy into the sandbox's own AnyHarness runtime (cloud-sandbox.ts). */
const PROXY = "/v1/gateway/cloud-sandbox/anyharness";

/** Hard per-run budget: one prompt, one cheap model, bounded waits. */
const SANDBOX_READY_TIMEOUT_MS = 180_000;
const TURN_TIMEOUT_MS = 120_000;
const TURN_POLL_MS = 3_000;

interface SessionSummary {
  id: string;
  status: string;
}

/**
 * T3-BATT-RUN-1 — the core product journey, live on staging: session → prompt
 * → one bounded agent turn → outcome observed.
 *
 * Journey: the durable user's personal cloud sandbox is materialized for real
 * (the same secret-PUT lever a first-time user hits), the sandbox's runtime
 * answers through the server's gateway proxy, a workspace + session are
 * created there on the CHEAPEST observed model, one prompt is sent, and the
 * turn completes within the budget — asserted from the event log
 * (`turn_ended`), never from what the agent said.
 *
 * EXPECTED-FAIL today (ruled 2026-08-26): the cloud session path is being
 * rebuilt (environments/seam), and the gap includes WORKSPACE PROVISIONING —
 * a fresh sandbox has no git checkout, and provisioning one through the
 * product is the not-yet-built half (t3-wt-1's sandbox lane documents the
 * same gap). Declared signatures: a strictly absent surface (404/405/501) on
 * the proxy path · WORKSPACE_CREATE_FAILED from the runtime · the sandbox
 * never reaching ready. A credits-exhausted 402 reports `blocked` (ops gate);
 * anything else is a real red.
 */
export const t3BattRun1: ScenarioDefinition = {
  id: "T3-BATT-RUN-1",
  title: "battery: cloud session → prompt → bounded agent turn → turn_ended observed",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user; materialize the personal cloud sandbox (bounded wait)" },
    { description: "probe the sandbox runtime through the gateway proxy (GET …/v1/agents)" },
    { description: "create a workspace + session on the cheapest observed model; send one prompt" },
    { description: "wait (bounded) for turn_ended in the session events; assert it was observed" },
    { description: "expected-fail today only on the surface-unavailable signature; 402 credits = blocked" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-RUN-1", ctx);
    const { client } = await authenticateBattery("T3-BATT-RUN-1", ctx);

    try {
      const sandbox = await warmPersonalCloudSandbox(client, { timeoutMs: SANDBOX_READY_TIMEOUT_MS });
      assert.equal(sandbox.status, "ready", "T3-BATT-RUN-1: the personal sandbox must reach ready");

      const agents = await probeAgentsThroughGateway(client);
      assert.ok(agents.length > 0, "T3-BATT-RUN-1: the sandbox runtime must list at least one agent");
      const agentKind = agents.find((agent) => agent.kind === "claude")?.kind ?? agents[0].kind;

      const launch = await client.get<{ options: { models: Array<{ id: string }> } | null }>(
        `${PROXY}/v1/agents/${encodeURIComponent(agentKind)}/launch-options`,
      );
      const modelId = cheapestModel((launch.options?.models ?? []).map((model) => model.id));

      const workspace = await ensureWorkspace(client);
      const session = await client.post<SessionSummary>(`${PROXY}/v1/sessions`, {
        workspaceId: workspace,
        agentKind,
        modelId,
      });
      assert.ok(session.id, "T3-BATT-RUN-1: session creation must return an id");

      await client.post(`${PROXY}/v1/sessions/${session.id}/prompt`, {
        blocks: [{ type: "text", text: "Reply with exactly the word: pong" }],
      });

      const deadline = Date.now() + TURN_TIMEOUT_MS;
      let events: SessionEventEnvelope[] = [];
      while (Date.now() < deadline) {
        events = await client.get<SessionEventEnvelope[]>(`${PROXY}/v1/sessions/${session.id}/events?limit=200`);
        if (findTurnEndedEvent(events)) {
          break;
        }
        await sleep(TURN_POLL_MS);
      }
      assert.ok(
        findTurnEndedEvent(events),
        `T3-BATT-RUN-1: turn_ended must be observed within ${TURN_TIMEOUT_MS}ms (saw ${events.length} events; ` +
          `last: ${events.at(-1)?.event.type ?? "none"})`,
      );

      console.log(
        `[T3-BATT-RUN-1/staging] green: sandbox ready, agent ${agentKind} on ${modelId ?? "default model"}, ` +
          `session ${session.id} completed one turn (${events.length} events).`,
      );
    } catch (error) {
      if (isBillingCreditsExhaustedError(error)) {
        throw new ScenarioBlockedError(
          "T3-BATT-RUN-1: the durable identity is credits-exhausted (402 billing_credits_exhausted) — an ops " +
            "provisioning gate on staging, not a product verdict. Grant the e2e subject cloud credit to unblock.",
        );
      }
      const isProvisioningGap =
        isSurfaceAbsent(error) ||
        errorCode(error) === "WORKSPACE_CREATE_FAILED" ||
        (error instanceof ApiRequestError && error.status === 400 && /workspace/i.test(describeFailure(error))) ||
        /did not reach status=ready/.test(describeFailure(error));
      if (isProvisioningGap) {
        throw new ScenarioExpectedFailError(
          "T3-BATT-RUN-1: the cloud session path (sandbox materialization → gateway proxy → workspace provisioning " +
            `→ runtime session) is not serving on staging — the environments/seam rebuild owns the fix ` +
            `(observed: ${describeFailure(error)})`,
        );
      }
      throw error;
    }
  },
};

/**
 * Reuses the sandbox's existing workspace (deterministically: lowest id) —
 * the product's own state in a warm sandbox — else attempts creation, whose
 * 400 WORKSPACE_CREATE_FAILED is part of the declared provisioning gap (the
 * runtime requires an existing git checkout, and provisioning one through
 * the product is the unbuilt half).
 */
async function ensureWorkspace(client: ApiClient): Promise<string> {
  const listed = await client.get<{ workspaces?: Array<{ id: string }> } | Array<{ id: string }>>(`${PROXY}/v1/workspaces`);
  const workspaces = (Array.isArray(listed) ? listed : (listed.workspaces ?? [])).slice();
  if (workspaces.length > 0) {
    workspaces.sort((a, b) => a.id.localeCompare(b.id));
    return workspaces[0].id;
  }
  const created = await client.post<{ workspace?: { id: string }; id?: string }>(`${PROXY}/v1/workspaces`, {
    path: "/home/user/release-e2e-battery",
  });
  const id = created.workspace?.id ?? created.id;
  assert.ok(id, "T3-BATT-RUN-1: workspace creation must return an id");
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
