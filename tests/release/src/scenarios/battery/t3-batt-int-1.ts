import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { ApiRequestError } from "../../fixtures/http.js";
import { resolveIntegrationNamespace } from "../../fixtures/integrations.js";
import {
  BATTERY_FLOW_REF,
  assertStagingLane,
  authenticateBattery,
  durableOrgId,
  isSurfaceAbsent,
  rethrowAsExpectedFail,
} from "./common.js";

interface CatalogItem {
  definitionId: string;
  namespace: string;
  authKind: string;
  displayName: string;
}

interface HealthItem {
  definitionId: string;
  namespace: string;
  accountId?: string | null;
  status?: string;
}

interface AuthenticateResponse {
  account: { accountId: string; namespace: string; status: string; enabled: boolean } | null;
}

/**
 * T3-BATT-INT-1 — an api_key integration connects, live on staging.
 *
 * Journey: the integration catalog lists the api_key-kind seed definition
 * (default `exa`), the health surface answers for the durable org, and — when
 * RELEASE_E2E_INTEGRATION_API_KEY is provisioned — connecting that definition
 * through the product route (`POST /v1/cloud/integrations/authentications`)
 * yields an enabled account that the health surface then reflects. Accounts
 * key per (user, definition) on the server, so a re-run against the durable
 * user tolerates 400/409 "already connected" and verifies via health instead
 * (T3-INT-1 does the same). Note: the server scopes the account per user, not
 * per org — no org parameter is sent on connect (an earlier draft passed an
 * inert `settings.organizationId`; the route only templates settings into
 * URLs/headers).
 *
 * EXPECTED-FAIL today (ruled 2026-08-26) is scoped to the CONNECT step only,
 * and only for strictly absent surfaces (404/405/501): the catalog and health
 * GETs are shipping surfaces whose failures — including a 404 from a wrong
 * RELEASE_E2E_DURABLE_ORG_ID — are real reds, never laundered into the gap.
 */
export const t3BattInt1: ScenarioDefinition = {
  id: "T3-BATT-INT-1",
  title: "battery: integration catalog → connect api_key integration → health reflects it",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user; resolve the api_key seed namespace" },
    { description: "GET /v1/cloud/integrations/catalog; assert the definition is cataloged as api_key (failures = real red)" },
    { description: "GET /v1/cloud/integrations/health for the durable org; assert it answers (failures = real red)" },
    { description: "with RELEASE_E2E_INTEGRATION_API_KEY: POST authentications (expected-fail scope); 400/409 = already connected → verify via health" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-INT-1", ctx);
    const { client } = await authenticateBattery("T3-BATT-INT-1", ctx);
    const namespace = resolveIntegrationNamespace();
    const orgId = durableOrgId();
    const orgQuery = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";

    // Shipping surfaces — failures here are genuine reds, never the known gap.
    const catalog = await client.get<{ items: CatalogItem[] }>(`/v1/cloud/integrations/catalog${orgQuery}`);
    assert.ok(catalog.items.length > 0, "T3-BATT-INT-1: the integration catalog must not be empty");
    const definition = catalog.items.find((item) => item.namespace === namespace);
    assert.ok(definition, `T3-BATT-INT-1: catalog must contain the "${namespace}" definition`);
    assert.equal(definition.authKind, "api_key", `T3-BATT-INT-1: "${namespace}" must be cataloged as api_key`);

    const health = await client.get<{ items: HealthItem[] }>(`/v1/cloud/integrations/health${orgQuery}`);
    assert.ok(Array.isArray(health.items), "T3-BATT-INT-1: health must answer with an item list");

    const apiKey = process.env.RELEASE_E2E_INTEGRATION_API_KEY?.trim();
    if (!apiKey) {
      throw new ScenarioBlockedError(
        "T3-BATT-INT-1: RELEASE_E2E_INTEGRATION_API_KEY is not provisioned — catalog + health verified, connect step " +
          "cannot run.",
      );
    }

    // The connect step — the declared gap's scope.
    let accountId: string | undefined;
    try {
      const connected = await client.post<AuthenticateResponse>("/v1/cloud/integrations/authentications", {
        definitionId: definition.definitionId,
        authKind: "api_key",
        apiKey,
      });
      assert.ok(connected.account, `T3-BATT-INT-1: connecting "${namespace}" must yield an account`);
      assert.equal(connected.account.enabled, true, "T3-BATT-INT-1: the connected account must be enabled");
      accountId = connected.account.accountId;
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 400 || error.status === 409)) {
        // Durable fixture: the account already exists from a prior run —
        // verified via health below, same tolerance T3-INT-1 applies.
        console.log(`[T3-BATT-INT-1/staging] connect returned ${error.status} — treating as already-connected.`);
      } else {
        rethrowAsExpectedFail(
          "T3-BATT-INT-1",
          error,
          isSurfaceAbsent,
          "the integration connect surface is not served on staging — the integration-gateway fix is in flight",
        );
      }
    }

    const after = await client.get<{ items: HealthItem[] }>(`/v1/cloud/integrations/health${orgQuery}`);
    const reflected = after.items.find((item) => item.namespace === namespace && item.accountId);
    assert.ok(reflected, `T3-BATT-INT-1: health must reflect a connected "${namespace}" account`);

    console.log(
      `[T3-BATT-INT-1/staging] green: "${namespace}" connected (account ${accountId ?? reflected.accountId}); ` +
        "health reflects it.",
    );
  },
};
