import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { catalogHarnesses, withGatewayProbedCandidates } from "./t3-chat-1.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ApiClient, ApiRequestError } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { resolveIntegrationNamespace } from "../fixtures/integrations.js";
import { ensureLocalClone } from "../fixtures/git.js";
import {
  LocalRuntimeClient,
  findErrorEvent,
  findTurnEndedEvent,
} from "../fixtures/local-runtime.js";
import {
  enrollGatewayWorker,
  gatewayCallTool,
  gatewayInitialize,
  gatewayListProviders,
  gatewayListTools,
  pickSearchTool,
  resolveRuntimeHome,
  runIntegrationAuditProbe,
  writeGatewayDotfile,
  type GatewayGrant,
  type ToolCallEvent,
} from "../fixtures/integration-gateway.js";

/**
 * T3-INT-1 — real integration through the gateway: every harness, both lanes.
 * specs/developing/testing/scenarios.md#T3-INT-1
 *
 * The contract: connect ONE real api_key-kind integration with a real key,
 * then for each cataloged harness the agent session calls a tool through the
 * integration gateway; assert the tool call succeeds (per-harness red), an
 * audit row is written (`cloud_integration_tool_call_event`, PR #1101), and an
 * org-policy toggle-off makes the same call return an enumerated scope/policy
 * error (toggled once, not per harness).
 *
 * Lane wiring (local):
 *  1. Connect Exa (product api_key flow, POST /v1/cloud/integrations/authentications).
 *  2. Provision a real gateway grant for the durable user (desktop enrollment +
 *     worker enroll — the exact endpoints the desktop app drives) and write the
 *     `integration-gateway.json` dotfile into the runtime home so the running
 *     runtime injects the `proliferate_integrations` MCP on the next session.
 *  3. Positive, per harness: run a real cheap agent turn (claude on its cheapest
 *     Anthropic/gateway model) prompted to run an Exa search THROUGH the gateway;
 *     assert an audit row with ok=true for the exa namespace appeared.
 *  4. Negative, once: toggle the org policy off for the exa definition, then a
 *     direct worker-bearer `integrations.call_tool` returns the enumerated
 *     `integration_provider_disabled` error and writes a failure audit row.
 *
 * The audit row is read back with a DB seam (`integration_audit_probe.py`) —
 * the same faithful read-only pattern as billing_probe.py, because this branch
 * exposes no HTTP surface listing these rows. The gateway that WRITES the row is
 * fully real.
 */
export const t3Int1: ScenarioDefinition = {
  id: "T3-INT-1",
  title: "real integration through the gateway — every harness, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-INT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_INTEGRATION_API_KEY",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  plan: ({ runtimeLane, agents }) => {
    const harnesses = agents.includes("all") ? ["claude", "codex", "cursor", "grok", "opencode"] : [...agents];
    return [
      { description: "connect the api_key integration once (default exa) via POST /v1/cloud/integrations/authentications" },
      { description: "provision a gateway grant (desktop enrollment + worker enroll) and write integration-gateway.json into the runtime home" },
      { description: "assert the gateway resolves the worker bearer (initialize) and lists exa as a ready provider" },
      ...harnesses.map((harness) => ({
        description: `[${harness}] agent turn calls an exa tool through the gateway (${runtimeLane} lane) → assert cloud_integration_tool_call_event ok=true`,
      })),
      { description: "org-policy toggle exa off (once) → direct gateway call returns integration_provider_disabled + failure audit row" },
    ];
  },
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }

    if (ctx.runtimeLane === "sandbox") {
      // Piggybacks T3-CHAT-1's session matrix, which is not yet implemented for
      // the sandbox lane (driving an agent session inside a real E2B sandbox
      // through the /v1/gateway/cloud-sandbox/anyharness/* proxy — needs a
      // running durable sandbox + a publicly reachable server URL). The gateway
      // audit assertion here reuses that same session driver, so the sandbox
      // lane is gated on the same TODO (#1042).
      throw new ScenarioExpectedFailError(
        "T3-INT-1/sandbox: reuses T3-CHAT-1's in-sandbox agent-session driver, which is not yet " +
          "implemented (needs a running durable E2B sandbox + a publicly reachable RELEASE_E2E_SERVER_URL " +
          "for the anyharness proxy). Tracked test TODO (#1042). The local lane fully exercises the " +
          "gateway audit path.",
      );
    }

    const integrationApiKey = process.env.RELEASE_E2E_INTEGRATION_API_KEY;
    const namespace = resolveIntegrationNamespace();
    if (!integrationApiKey || integrationApiKey.trim().length === 0) {
      throw new ScenarioBlockedError(
        `T3-INT-1: blocked on credential — RELEASE_E2E_INTEGRATION_API_KEY is not set. ` +
          `Mint a real api_key for the "${namespace}" integration (default: an Exa API key from https://exa.ai) ` +
          `and add it to ~/.proliferate-local/dev/release-e2e.env (and the CI secret).`,
      );
    }

    await runLocalLane(ctx.env.require("RELEASE_E2E_SERVER_URL"), namespace, integrationApiKey, ctx.agents);
  },
};

interface PerHarnessResult {
  harnessKind: string;
  status: "green" | "skipped-no-anthropic-model" | "red";
  detail: string;
}

async function runLocalLane(
  serverUrl: string,
  namespace: string,
  apiKey: string,
  agentsSelector: readonly string[],
): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const organizationId = process.env.RELEASE_E2E_DURABLE_ORG_ID as string;

  const runtimeHome = resolveRuntimeHome();
  if (!runtimeHome) {
    throw new ScenarioBlockedError(
      "T3-INT-1: blocked — cannot resolve the AnyHarness runtime home. Set ANYHARNESS_RUNTIME_HOME to the " +
        "same path the local runtime was booted with (the dir the gateway dotfile is read from).",
    );
  }

  const session = await loginDurableUser({ serverUrl, email: durableEmail, password: durablePassword, organizationId });
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  // 1) Connect the integration (idempotent: a prior run may have connected it).
  const catalog = await client.get<{ items: Array<{ definitionId: string; namespace: string }> }>(
    "/v1/cloud/integrations/catalog",
  );
  const definition = catalog.items.find((item) => item.namespace === namespace);
  assert.ok(definition, `T3-INT-1: catalog must contain an api_key-kind definition for namespace "${namespace}"`);
  await connectIntegration(client, definition.definitionId, apiKey);

  // 2) Provision the gateway grant and write the dotfile the runtime injects.
  const grant = await enrollGatewayWorker(client, { serverUrl, organizationId });
  await writeGatewayDotfile(runtimeHome, grant);

  try {
    // 3) Gateway wiring check: the worker bearer resolves and exa is ready.
    await assertGatewayReady(grant, namespace);

    // 4) Positive, per harness: a real agent turn calls exa through the gateway.
    const perHarness = await runAgentToolCallMatrix(client, grant, namespace, durableEmail, agentsSelector);

    console.log("[T3-INT-1/local] per-harness results:");
    for (const result of perHarness) {
      console.log(`  - ${result.harnessKind}: ${result.status} (${result.detail})`);
    }
    const green = perHarness.filter((r) => r.status === "green");
    const red = perHarness.filter((r) => r.status === "red");
    assert.ok(
      green.length > 0,
      `T3-INT-1/local: at least one Anthropic-family harness (claude) must call a tool through the gateway and ` +
        `produce an ok=true audit row. Reds: ${red.map((r) => `${r.harnessKind}: ${r.detail}`).join("; ") || "none"}`,
    );
    if (red.length > 0) {
      console.warn(`[T3-INT-1/local] ${red.length} harness(es) red: ${red.map((r) => r.harnessKind).join(", ")}`);
    }

    // 5) Negative, once: org-policy toggle-off → enumerated disabled error + audit row.
    await assertOrgPolicyToggleOff(client, grant, definition.definitionId, namespace, organizationId, durableEmail);
  } finally {
    // Best-effort teardown: retire the worker so the dotfile bearer is revoked.
    await client
      .post("/v1/cloud/workers/desktop/revoke", { desktopInstallId: grant.desktopInstallId })
      .catch(() => undefined);
  }
}

async function connectIntegration(client: ApiClient, definitionId: string, apiKey: string): Promise<void> {
  try {
    const response = await client.post<{ account: { accountId: string } }>(
      "/v1/cloud/integrations/authentications",
      { definitionId, authKind: "api_key", apiKey },
    );
    assert.ok(response.account.accountId, "T3-INT-1: connecting the integration must return an account id");
  } catch (error) {
    // A durable user re-runs against a persistent server: an existing account
    // is fine (the gateway readiness check below is the real gate).
    if (error instanceof ApiRequestError && (error.status === 409 || error.status === 400)) {
      console.log(`[T3-INT-1] integration already connected (${error.status}) — reusing existing account.`);
      return;
    }
    throw error;
  }
}

async function assertGatewayReady(grant: GatewayGrant, namespace: string): Promise<void> {
  let initialized;
  try {
    initialized = await gatewayInitialize(grant);
  } catch (error) {
    throw new ScenarioBlockedError(
      `T3-INT-1: blocked — the gateway MCP endpoint did not accept the worker bearer (${
        error instanceof Error ? error.message : String(error)
      }). The enrollment/dotfile wiring failed; the agent could never reach the gateway.`,
    );
  }
  assert.ok(initialized.result, "T3-INT-1: gateway initialize must return a result");
  const providers = await gatewayListProviders(grant);
  const exa = providers.find((p) => p.provider === namespace);
  assert.ok(
    exa && exa.status === "ready",
    `T3-INT-1: the "${namespace}" provider must be connected and ready through the gateway (got ${JSON.stringify(providers)})`,
  );
}

async function runAgentToolCallMatrix(
  _client: ApiClient,
  grant: GatewayGrant,
  namespace: string,
  durableEmail: string,
  agentsSelector: readonly string[],
): Promise<PerHarnessResult[]> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const runtime = new LocalRuntimeClient({ baseUrl: runtimeUrl });
  const requested = agentsSelector.includes("all")
    ? ["claude", "codex", "cursor", "grok", "opencode"]
    : [...agentsSelector];
  const choices = await catalogHarnesses(requested);

  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const repoPath = await ensureLocalClone(githubTestRepo);
  const { workspace } = await runtime.createLocalWorkspace(repoPath);

  const results: PerHarnessResult[] = [];
  try {
    for (const harnessKind of requested) {
      const choice = choices.get(harnessKind);
      if (!choice) {
        results.push({
          harnessKind,
          status: "skipped-no-anthropic-model",
          detail: "no Anthropic-family model in catalogs/agents/catalog.json (needs its own provider key)",
        });
        continue;
      }
      try {
        await runOneHarnessToolCall(runtime, grant, workspace.id, harnessKind, choice, namespace, durableEmail);
        results.push({ harnessKind, status: "green", detail: "agent called an exa tool → ok=true audit row" });
      } catch (error) {
        results.push({ harnessKind, status: "red", detail: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await runtime.deleteWorkspace(workspace.id).catch(() => undefined);
  }
  return results;
}

async function runOneHarnessToolCall(
  runtime: LocalRuntimeClient,
  grant: GatewayGrant,
  workspaceId: string,
  harnessKind: string,
  choice: { modelCandidates: string[] },
  namespace: string,
  durableEmail: string,
): Promise<void> {
  await runtime.installAgent(harnessKind).catch(() => undefined);
  const candidates = await withGatewayProbedCandidates(runtime, harnessKind, choice.modelCandidates);

  // Snapshot the audit rows before the turn so we assert on the delta.
  const before = await runIntegrationAuditProbe(durableEmail, { namespace, sinceSeconds: 3600 });
  const seenIds = new Set(before.events.map((e) => e.id));

  const prompt =
    `You have an MCP server named "proliferate_integrations" that proxies external integrations. ` +
    `Run a real web search through it with the "${namespace}" provider: call the tool ` +
    `"integrations.list_tools" with {"provider":"${namespace}"} to discover the search tool, then call ` +
    `"integrations.call_tool" with the "${namespace}" provider, that search tool, and a query for ` +
    `"Proliferate AI coding agents". You MUST call integrations.call_tool. Reply with one result URL.`;

  let lastError: unknown;
  for (const modelId of candidates) {
    try {
      const session = await runtime.createSession({ workspaceId, agentKind: harnessKind, modelId });
      await runtime.prompt(session.id, prompt);
      await runtime.waitForIdle(session.id, { timeoutMs: 120_000 });
      const events = await runtime.getEvents(session.id);
      const errorMessage = findErrorEvent(events);
      assert.equal(errorMessage, undefined, `[${harnessKind}] session must not error: ${errorMessage}`);
      assert.ok(findTurnEndedEvent(events), `[${harnessKind}] turn_ended event must be observed`);

      // Assert the agent's call reached the gateway: a NEW ok=true audit row.
      const after = await pollForNewOkEvent(durableEmail, namespace, seenIds);
      assert.ok(
        after,
        `[${harnessKind}] expected a NEW cloud_integration_tool_call_event with ok=true for "${namespace}" after the turn ` +
          `(model=${modelId}); the agent did not call integrations.call_tool through the gateway`,
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function pollForNewOkEvent(
  durableEmail: string,
  namespace: string,
  seenIds: Set<string>,
): Promise<ToolCallEvent | undefined> {
  // The audit row is committed in the same request that proxies the tool call,
  // so it is present by turn end; poll briefly to absorb any event-log lag.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const probe = await runIntegrationAuditProbe(durableEmail, { namespace, sinceSeconds: 3600 });
    const fresh = probe.events.find((e) => !seenIds.has(e.id) && e.ok);
    if (fresh) {
      return fresh;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return undefined;
}

async function assertOrgPolicyToggleOff(
  client: ApiClient,
  grant: GatewayGrant,
  definitionId: string,
  namespace: string,
  organizationId: string,
  durableEmail: string,
): Promise<void> {
  // Discover a real tool name so the audit row records a realistic tool_name;
  // the policy gate rejects before tool resolution regardless.
  let toolName = "search";
  try {
    const tools = await gatewayListTools(grant, namespace);
    const picked = pickSearchTool(tools, "Proliferate AI");
    if (picked) {
      toolName = picked.tool;
    }
  } catch {
    // list_tools may itself be gated once disabled; fall back to a literal name.
  }

  const before = await runIntegrationAuditProbe(durableEmail, { namespace, sinceSeconds: 3600 });
  const seenIds = new Set(before.events.map((e) => e.id));

  const path = `/v1/cloud/integrations/admin/organizations/${organizationId}/definitions/${definitionId}/enabled`;
  await client.patch(path, { enabled: false });
  try {
    const result = await gatewayCallTool(grant, namespace, toolName, {});
    assert.ok(
      result.isError,
      `T3-INT-1: with the org policy disabled, the gateway call must return an enumerated error (got isError=false: ${result.message})`,
    );
    assert.match(
      result.message,
      /disabled/i,
      `T3-INT-1: the disabled-policy error must name the policy (got: ${result.message})`,
    );

    const after = await runIntegrationAuditProbe(durableEmail, { namespace, sinceSeconds: 3600 });
    const failureRow = after.events.find(
      (e) => !seenIds.has(e.id) && !e.ok && e.errorCode === "integration_provider_disabled",
    );
    assert.ok(
      failureRow,
      `T3-INT-1: the disabled call must write a failure audit row with error_code=integration_provider_disabled ` +
        `(new rows: ${JSON.stringify(after.events.filter((e) => !seenIds.has(e.id)))})`,
    );
  } finally {
    // Re-enable so the definition is left as found (durable server).
    await client.patch(path, { enabled: true }).catch(() => undefined);
  }
}
