import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { resolveIntegrationNamespace } from "../../fixtures/integrations.js";
import {
  BATTERY_FLOW_REF,
  assertStagingLane,
  authenticateBattery,
  durableOrgId,
  isSurfaceUnavailable,
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
 * (default `exa`, `RELEASE_E2E_INTEGRATION_NAMESPACE` to override), the health
 * surface answers for the durable org, and — when RELEASE_E2E_INTEGRATION_API_KEY
 * is provisioned — connecting that definition through the product route
 * (`POST /v1/cloud/integrations/authentications`) yields an enabled account
 * that the health surface then reflects. T3-INT-1 owns the deeper tool-call
 * matrix; this journey owns "does connecting work at all".
 *
 * EXPECTED-FAIL today (ruled 2026-08-26): the integration gateway is mid-fix.
 * Declared ONLY on the surface-unavailable signature (404/405/5xx); an
 * auth/validation failure is a real red.
 */
export const t3BattInt1: ScenarioDefinition = {
  id: "T3-BATT-INT-1",
  title: "battery: integration catalog → connect api_key integration → health reflects it",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user; resolve the api_key seed namespace" },
    { description: "GET /v1/cloud/integrations/catalog; assert the definition is cataloged as api_key" },
    { description: "GET /v1/cloud/integrations/health for the durable org; assert it answers" },
    { description: "with RELEASE_E2E_INTEGRATION_API_KEY: POST authentications; assert an enabled account; health reflects it" },
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

    try {
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
      const connected = await client.post<AuthenticateResponse>("/v1/cloud/integrations/authentications", {
        definitionId: definition.definitionId,
        authKind: "api_key",
        apiKey,
        ...(orgId ? { settings: { organizationId: orgId } } : {}),
      });
      assert.ok(connected.account, `T3-BATT-INT-1: connecting "${namespace}" must yield an account`);
      assert.equal(connected.account.enabled, true, "T3-BATT-INT-1: the connected account must be enabled");

      const after = await client.get<{ items: HealthItem[] }>(`/v1/cloud/integrations/health${orgQuery}`);
      const reflected = after.items.find((item) => item.namespace === namespace && item.accountId);
      assert.ok(reflected, `T3-BATT-INT-1: health must reflect the connected "${namespace}" account`);

      console.log(
        `[T3-BATT-INT-1/staging] green: "${namespace}" connected (account ${connected.account.accountId}, ` +
          `status ${connected.account.status}); health reflects it.`,
      );
    } catch (error) {
      if (error instanceof ScenarioBlockedError) {
        throw error;
      }
      rethrowAsExpectedFail(
        "T3-BATT-INT-1",
        error,
        isSurfaceUnavailable,
        "integration connect surface failing on staging — the integration gateway fix is in flight",
      );
    }
  },
};
