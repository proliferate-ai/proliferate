import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import { ApiClient, ApiRequestError } from "../../fixtures/http.js";
import { resolveIntegrationNamespace } from "../../fixtures/integrations.js";
import {
  archiveWorkflow,
  createWorkflow,
  openDurableWorkflowClient,
  readWorkflowFixture,
} from "../../fixtures/workflows.js";

/**
 * T3-WF-3 — integration scoping (`wf-integration-denied`).
 * specs/developing/testing/scenarios.md#T3-WF-3
 *
 * Contract: the workflow grants NO integrations, but the agent is told to use a
 * connected provider (default exa). `list_providers` must not show it, a forced
 * `call_tool` gets a scope 403, and ZERO upstream calls happen. The assertion is
 * at the gateway (audit + absence of an upstream call), never the agent's prose.
 *
 * Setup that runs for real: connect the real api_key provider (the same connect
 * path + credential as T3-INT-1, RELEASE_E2E_INTEGRATION_API_KEY) so the
 * "connected but ungranted" precondition is genuine, and create the ungranted
 * workflow (which saves — integrations:[]). The forced-call scope-403 proof needs
 * either an executing agent OR the run's minted gateway token driven directly
 * against the gateway MCP (the LLM-free deterministic gate T3-INT-1 uses); both
 * need a StartRun that reaches the gateway, which needs a runnable target the
 * release runner does not yet stand up locally (desktop executor / cloud sandbox).
 */
export const t3Wf3: ScenarioDefinition = {
  id: "T3-WF-3",
  title: "integration scoping — connected but ungranted",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WF-3",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_INTEGRATION_API_KEY",
  ],
  plan: () => [
    { description: "connect a real api_key provider (default exa) so it is genuinely connected for the owner" },
    { description: "create wf-integration-denied (integrations: []) — the provider is connected but NOT granted" },
    { description: "assert list_providers via the run's gateway grant does not surface the ungranted provider" },
    { description: "force a call_tool for the ungranted provider → scope 403 audit row, zero upstream calls" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      throw new ScenarioBlockedError(
        "T3-WF-3/staging: deferred — connects an integration + creates a workflow/run against the SHARED durable " +
          "user/org. Needs a dedicated non-shared staging fixture (same posture as T3-INT-1/staging).",
      );
    }
    if (ctx.runtimeLane === "sandbox") {
      throw new ScenarioExpectedFailError(
        "T3-WF-3/sandbox: the forced-call scope proof needs an executing agent (in-sandbox delivery + publicly " +
          "reachable RELEASE_E2E_SERVER_URL), not yet driven by the runner (#1042).",
      );
    }

    const apiKey = process.env.RELEASE_E2E_INTEGRATION_API_KEY;
    const namespace = resolveIntegrationNamespace();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ScenarioBlockedError(
        `T3-WF-3: blocked on credential — RELEASE_E2E_INTEGRATION_API_KEY is not set (mint a "${namespace}" key, ` +
          "e.g. a free Exa key from https://exa.ai) so the provider is genuinely connected-but-ungranted.",
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const client = await openDurableWorkflowClient(serverUrl);
    await connectProvider(client, namespace, apiKey);

    const definition = await readWorkflowFixture("wf-integration-denied");
    const created = await createWorkflow(client, definition, { nameSuffix: "wf3" });
    try {
      throw new ScenarioExpectedFailError(
        "T3-WF-3/local: precondition established for real — the provider is connected and the ungranted workflow " +
          "saved with an empty integrations grant. The scope-403 proof (list_providers omits it + forced call_tool " +
          "returns integration_gateway_scope_denied + zero upstream calls) needs a StartRun that reaches the " +
          "gateway, which needs an agent runner (desktop executor / cloud sandbox) the runner does not stand up " +
          "locally. T3-INT-1 owns the deterministic gateway-token gate this reuses.",
      );
    } finally {
      await archiveWorkflow(client, created.workflow.id);
    }
  },
};

async function connectProvider(client: ApiClient, namespace: string, apiKey: string): Promise<void> {
  const catalog = await client.get<{ items: Array<{ definitionId: string; namespace: string }> }>(
    "/v1/cloud/integrations/catalog",
  );
  const definition = catalog.items.find((item) => item.namespace === namespace);
  if (!definition) {
    throw new ScenarioBlockedError(`T3-WF-3: no api_key catalog definition for namespace "${namespace}".`);
  }
  try {
    await client.post("/v1/cloud/integrations/authentications", {
      definitionId: definition.definitionId,
      authKind: "api_key",
      apiKey,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 409 || error.status === 400)) {
      return; // already connected on the durable user
    }
    throw error;
  }
}
