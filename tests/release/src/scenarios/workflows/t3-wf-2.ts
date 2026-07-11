import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import { ApiClient, ApiRequestError } from "../../fixtures/http.js";
import {
  archiveWorkflow,
  createWorkflow,
  isApiError,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-2 — function invocations + denial (`wf-invoke-allowed` / `wf-invoke-denied`).
 * specs/developing/testing/scenarios.md#T3-WF-2
 *
 * Contract: allowed → the agent's call reaches the local capture endpoint
 * (request recorded, args schema-validated); denied → gateway scope 403 in the
 * audit, ZERO outbound requests, run still completes with the agent's emitted
 * failure report. The deny-path assertion is at the GATEWAY (audit row +
 * absence of an outbound request), never the agent's prose.
 *
 * A scenario-local capture endpoint (node http server) records the allowed run's
 * outbound HTTP — the same trick as tests/intent/stack/invocation-stub.ts, copied
 * here (no cross-suite import per the tier-3 house rule).
 *
 * PRODUCT GAP found building this scenario (2026-07-10), FIXED in the same PR:
 * a workflow could not GRANT the reserved `functions` namespace — save rejected
 * `integrations: ["functions"]` with `workflow_function_provider_unknown`
 * because `visible_provider_namespaces` only knew integration-definition
 * namespaces and the L22 readiness gate required a ready ACCOUNT. Both now
 * accept the virtual `functions` provider when the owner has ≥1 live invocation
 * (gateway_grants.py; unit-tested in test_workflow_service.py's functions-
 * namespace tests). The remaining expected-fail on the allowed half is the
 * agent-runner gap (#1042): asserting the captured outbound call needs an
 * executing agent, which the release runner does not yet stand up locally.
 */
export const t3Wf2: ScenarioDefinition = {
  id: "T3-WF-2",
  title: "function invocations + denial",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-2",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "stand up a scenario-local capture endpoint (node http server) recording inbound requests" },
    { description: "create a function invocation (POST /v1/cloud/integrations/functions) pointing at the capture endpoint" },
    { description: "create wf-invoke-allowed (grants functions) and wf-invoke-denied (no grant)" },
    { description: "allowed: StartRun → run completes; capture endpoint recorded exactly one request with schema-valid args" },
    { description: "denied: StartRun → run completes; gateway scope 403 audit row; ZERO capture requests; agent emitted a failure report" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-2/staging: deferred — creates invocations + workflows + runs against the SHARED durable user/org. " +
          "Needs a dedicated non-shared staging fixture (same posture as T3-INT-1/staging).",
      );
    }
    if (ctx.runtimeLane === "sandbox") {
      throw new ScenarioExpectedFailError(
        "T3-WF-2/sandbox: the allowed/denied calls need an executing agent (in-sandbox delivery path + publicly " +
          "reachable RELEASE_E2E_SERVER_URL), which the release runner does not yet drive (#1042).",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    const capture = await startCaptureServer();

    try {
      // Setup that IS wired today: function-invocation CRUD.
      await ensureInvocation(client, capture.baseUrl);

      // The allowed half: creating the granting workflow is the product gap.
      await assertAllowedHalfOrDiagnose(client);

      // The denied half: fixture creates fine (no functions grant); execution
      // still needs an agent runner locally (desktop executor), so the deny
      // proof (audit 403 + zero capture requests) is gated on that runner.
      await assertDeniedHalfOrDiagnose(client, capture);
    } finally {
      await capture.close();
    }
  },
};

async function ensureInvocation(client: ApiClient, endpointBase: string): Promise<void> {
  const body = {
    name: "capture_event",
    displayName: "Capture Event",
    description: "T3-WF-2 capture endpoint",
    endpointUrl: `${endpointBase}/capture`,
    method: "post",
    argsSchema: {
      type: "object",
      properties: { payload: { type: "string" } },
      required: ["payload"],
      additionalProperties: false,
    },
    headers: { "x-api-key": "t3-wf-2-key" },
  };
  try {
    await client.post("/v1/cloud/integrations/functions", body);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 409 || error.status === 400)) {
      // Durable server: the invocation may already exist from a prior run.
      return;
    }
    throw error;
  }
}

async function assertAllowedHalfOrDiagnose(client: ApiClient): Promise<void> {
  const definition = await readWorkflowFixture("wf-invoke-allowed");
  let workflowId: string | undefined;
  try {
    const created = await createWorkflow(client, definition, { nameSuffix: "wf2allow" });
    workflowId = created.workflow.id;
  } catch (error) {
    if (isApiError(error, "workflow_function_provider_unknown", "invalid_payload")) {
      // Regression guard: this exact rejection was the 2026-07-10 product gap,
      // fixed by teaching visible_provider_namespaces + the L22 readiness gate
      // about the virtual `functions` provider. Reappearing = a real red.
      throw new Error(
        "T3-WF-2 (allowed): REGRESSION — the reserved `functions` namespace grant was rejected at save " +
          "(`workflow_function_provider_unknown`). This path was fixed in gateway_grants.py " +
          "(visible_provider_namespaces + assert_declared_providers_ready accept the virtual provider when " +
          "the owner has a live invocation); its unit tests are test_workflow_service.py::test_functions_*.",
      );
    }
    throw error;
  }
  // If it ever creates, the run still needs an agent runner (see denied half).
  if (workflowId) {
    await archiveWorkflow(client, workflowId);
  }
  throw new ScenarioExpectedFailError(
    "T3-WF-2 (allowed): the functions grant now saves — wire the StartRun + capture-request assertion once an " +
      "agent runner (cloud sandbox / desktop executor) is available in the runner.",
  );
}

async function assertDeniedHalfOrDiagnose(client: ApiClient, capture: CaptureServer): Promise<void> {
  const definition = await readWorkflowFixture("wf-invoke-denied");
  const created = await createWorkflow(client, definition, { nameSuffix: "wf2deny" });
  try {
    // The denied definition saves (no functions grant). The deny proof — a
    // gateway scope 403 in the audit and ZERO outbound requests to the capture
    // endpoint while the run still completes — needs the agent to actually run.
    assert.equal(capture.requests().length, 0, "T3-WF-2: no capture request may occur before the run executes");
    throw new ScenarioExpectedFailError(
      "T3-WF-2 (denied): the ungranted-functions workflow saved (definition validation OK). Asserting the gateway " +
        "scope 403 + zero outbound requests + completed run with a failure emit needs an executing agent " +
        "(desktop executor locally, or the in-sandbox path), which the release runner does not yet stand up.",
    );
  } finally {
    await archiveWorkflow(client, created.workflow.id);
  }
}

// --- scenario-local capture endpoint (copied from the intent invocation-stub pattern) ---

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface CaptureServer {
  baseUrl: string;
  requests: () => RecordedRequest[];
  close: () => Promise<void>;
}

async function startCaptureServer(): Promise<CaptureServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: req.headers,
      body,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("capture server did not bind a port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: () => [...requests],
    close: () => closeServer(server),
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
