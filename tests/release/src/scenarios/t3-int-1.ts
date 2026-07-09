import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { resolveIntegrationNamespace } from "../fixtures/integrations.js";

/**
 * T3-INT-1 — real integration through the gateway: every harness, both lanes.
 * specs/developing/testing/scenarios.md#T3-INT-1
 *
 * The contract: connect ONE real api_key-kind integration with a real key,
 * then for each cataloged harness in both lanes the agent session calls a tool
 * through the integration gateway; assert the tool call succeeds (per-harness
 * red), an audit row is written, and an org-policy toggle-off makes the same
 * call return an enumerated scope/policy error (toggled once, not per harness).
 *
 * Two real, out-of-band blockers on this branch, reported (not silently
 * skipped) in priority order:
 *
 * 1. Credential — `RELEASE_E2E_INTEGRATION_API_KEY` does not exist yet. Without
 *    a real key there is no real authentication and no real tool call, which is
 *    the whole point of this scenario, so it reports blocked-on-credential.
 *    Mint an Exa key (default namespace) or set RELEASE_E2E_INTEGRATION_NAMESPACE
 *    to another api_key-kind seed (context7|exa|tavily|render|neon).
 *
 * 2. Gate — both the connect route (`POST /v1/cloud/integrations/authentications`)
 *    and the gateway route (`POST /v1/cloud/integration-gateway/mcp`) are
 *    `current_product_user`-gated; a password-only durable user 403s with
 *    `github_link_required` (verified live 2026-07-08). `withProductGate`
 *    reports that as blocked until PR #1023 merges and
 *    GITHUB_LINK_GATE_WORKAROUND_ACTIVE flips.
 *
 * Finding (documented in src/fixtures/integrations.ts, filed as
 * https://github.com/proliferate-ai/proliferate/issues/1030): the contract's
 * Slack bot-token example does not match the shipped catalog — Slack is
 * cataloged auth_kind=oauth2 (hosted MCP), so this scenario uses a real
 * api_key-kind seed integration instead.
 */
export const t3Int1: ScenarioDefinition = {
  id: "T3-INT-1",
  title: "real integration through the gateway — every harness, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-INT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"],
  plan: ({ runtimeLane, agents }) => {
    const harnesses = agents.includes("all") ? ["claude", "codex", "cursor", "grok", "opencode"] : [...agents];
    return [
      { description: "resolve the api_key-kind integration namespace (default exa) from the seed catalog" },
      {
        description:
          "connect the integration once with the real key " +
          "(POST /v1/cloud/integrations/authentications, authKind api_key)",
      },
      ...harnesses.map((harness) => ({
        description: `[${harness}] agent session calls a tool through the integration gateway (${runtimeLane} lane) → assert success + audit row`,
      })),
      { description: "org-policy toggle the definition off (once) → same tool call returns an enumerated scope/policy error" },
    ];
  },
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }

    if (ctx.targetLane === "staging") {
      // Deferred from the first staging pass: connecting an integration writes a
      // real credential/authentication against the SHARED durable user/org, and
      // the per-harness gateway tool-call matrix needs real sandboxes. To avoid
      // mutating shared staging integration state this reports blocked until a
      // dedicated non-shared staging fixture exists. See tests/release/README.md
      // (staging-lane runbook).
      throw new ScenarioBlockedError(
        "T3-INT-1/staging: deferred from the first staging pass — connecting the integration writes a real " +
          "credential against the SHARED durable user/org and the tool-call matrix needs real sandboxes. " +
          "Needs a dedicated non-shared staging fixture before it can run for real.",
      );
    }

    // Blocker 1 (credential) takes priority over the gate: without a real key
    // there is nothing to authenticate, regardless of the gate.
    const integrationApiKey = process.env.RELEASE_E2E_INTEGRATION_API_KEY;
    const namespace = resolveIntegrationNamespace();
    if (!integrationApiKey || integrationApiKey.trim().length === 0) {
      throw new ScenarioBlockedError(
        `T3-INT-1: blocked on credential — RELEASE_E2E_INTEGRATION_API_KEY is not set. ` +
          `Mint a real api_key for the "${namespace}" integration (default: an Exa API key from ` +
          `https://exa.ai) and add it to ~/.proliferate-local/dev/release-e2e.env (and the CI secret). ` +
          `Note: the cataloged Slack integration is oauth2/hosted-MCP, so RELEASE_E2E_SLACK_BOT_TOKEN ` +
          `cannot satisfy this — see src/fixtures/integrations.ts.`,
      );
    }

    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    await withProductGate("T3-INT-1", () => runReal(serverUrl, namespace, integrationApiKey, ctx.agents));
  },
};

async function runReal(
  serverUrl: string,
  namespace: string,
  apiKey: string,
  _agents: readonly string[],
): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const session = await loginDurableUser({
    serverUrl,
    email: durableEmail,
    password: durablePassword,
    organizationId: process.env.RELEASE_E2E_DURABLE_ORG_ID ?? "",
  });
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  // The auth endpoint takes a UUID definitionId, not a namespace string
  // (server/proliferate/server/cloud/integrations/models.py:34-41), so resolve
  // it from the seed catalog first.
  const catalog = await client.get<{ items: Array<{ definitionId: string; namespace: string }> }>(
    "/v1/cloud/integrations/catalog",
  );
  const definition = catalog.items.find((item) => item.namespace === namespace);
  assert.ok(definition, `T3-INT-1: catalog must contain an api_key-kind definition for namespace "${namespace}"`);

  // First real, gated call: connect the integration. Reaching past this means
  // the github_link gate lifted (withProductGate would otherwise report
  // blocked). The per-harness gateway tool-call matrix, the audit-row
  // assertion, and the org-policy toggle-off negative are intentionally not
  // implemented beyond this first real call — the response shapes for the
  // gateway MCP route and the audit store are asserted against the live
  // server once this scenario is actually reachable, following the same
  // "finish it when the gate is open" convention as T3-PROV-2 / T3-SEC-MAT-1.
  const response = await client.post<{ account: { accountId: string; definitionId: string; namespace: string } }>(
    "/v1/cloud/integrations/authentications",
    { definitionId: definition.definitionId, authKind: "api_key", apiKey },
  );
  assert.ok(response.account.accountId, "T3-INT-1: connecting the integration must return an account id");

  throw new ScenarioExpectedFailError(
    "T3-INT-1: integration connect verified against the live server on fresh main (single-org " +
      "current_product_user bypass; real api_key connect returned an account id). The per-harness × " +
      "per-lane gateway tool-call matrix, the audit-row assertion, and the org-policy toggle-off " +
      "negative are not yet implemented — tracked test TODO (#1041/#1042).",
  );
}
