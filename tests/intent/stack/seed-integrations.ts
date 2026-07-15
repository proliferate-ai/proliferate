// Integrations seeding + API helpers (T2-INT-1). Split from seed.ts (already
// near this repo's 600-line file-size convention, scripts/check_max_lines.py)
// rather than growing it further — same spirit as the shared `apiRequest`
// primitive, just a dedicated home for the integrations surface.
//
// The one direct-DB read here (resolving a seed integration definition's id)
// is the same kind of "seed via the product's own data, no API to read it
// back" case `backdateInvitationExpiry` already established in seed.ts:
// there is still no catalog-by-namespace lookup, only the full
// `GET /integrations/catalog` list, so resolving one real definition's id
// directly against `cloud_integration_definition` is the more direct way to
// bootstrap the fixture. `sync_seed_definitions` (server/proliferate/main.py)
// upserts every entry in `SEED_DEFINITIONS`
// (server/proliferate/server/cloud/integrations/seeds.py) into
// `cloud_integration_definition` on every server boot, so reading the row
// directly is reading real seeded product data, not fabricating a stub.

import { Client } from "pg";
import { apiRequest, databaseUrl, toPostgresDriverUrl } from "./seed.ts";

interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * Resolve a real seed integration definition's id by namespace, direct from
 * `cloud_integration_definition` (source='seed'). `context7` is `api_key`-kind
 * per SEED_DEFINITIONS and is what this suite uses as its real,
 * no-stub-provider connect target.
 */
export async function getSeedIntegrationDefinitionId(namespace: string): Promise<string> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM cloud_integration_definition WHERE source = 'seed' AND namespace = $1`,
      [namespace],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `No seed integration definition found for namespace "${namespace}" — did sync_seed_definitions run at server boot?`,
      );
    }
    return row.id;
  } finally {
    await client.end();
  }
}

export interface IntegrationAccountResult {
  account: {
    accountId: string;
    definitionId: string;
    namespace: string;
    displayName: string;
    authKind: string;
    status: string;
    enabled: boolean;
  };
  oauthFlowId: string | null;
  authorizationUrl: string | null;
  expiresAt: string | null;
}

/** `POST /v1/integrations/authentications` (authKind api_key). Placeholder
 * key value — this path never validates it against the provider (ruled
 * 2026-07-08, scenarios.md: "no stub/fake integration provider", real
 * definition + placeholder credential, no outbound call in tier 2). */
export async function authenticateApiKeyIntegration(
  token: string,
  definitionId: string,
  apiKey: string,
): Promise<ApiResult<IntegrationAccountResult>> {
  return apiRequest<IntegrationAccountResult>("/v1/cloud/integrations/authentications", {
    method: "POST",
    token,
    body: { definitionId, authKind: "api_key", apiKey },
  });
}

export interface IntegrationCatalogItemResult {
  definitionId: string;
  namespace: string;
  displayName: string;
  authKind: string;
}

export async function getIntegrationCatalog(
  token: string,
): Promise<ApiResult<{ items: IntegrationCatalogItemResult[] }>> {
  return apiRequest<{ items: IntegrationCatalogItemResult[] }>("/v1/cloud/integrations/catalog", { token });
}

export interface AdminIntegrationDefinitionResult {
  definitionId: string;
  namespace: string;
  displayName: string;
  source: string;
  organizationId: string | null;
  authKind: string;
  enabledByDefault: boolean;
  policyEnabled: boolean | null;
  effectiveEnabled: boolean;
}

export async function setAdminIntegrationEnabled(
  token: string,
  organizationId: string,
  definitionId: string,
  enabled: boolean,
): Promise<ApiResult<AdminIntegrationDefinitionResult>> {
  return apiRequest<AdminIntegrationDefinitionResult>(
    `/v1/cloud/integrations/admin/organizations/${organizationId}/definitions/${definitionId}/enabled`,
    { method: "PATCH", token, body: { enabled } },
  );
}

export async function listAdminIntegrationDefinitions(
  token: string,
  organizationId: string,
): Promise<ApiResult<AdminIntegrationDefinitionResult[]>> {
  return apiRequest<AdminIntegrationDefinitionResult[]>(
    `/v1/cloud/integrations/admin/organizations/${organizationId}/definitions`,
    { token },
  );
}

// Health surface (`GET /integrations/health`, health.py): the one response
// that carries all three enablement layers side by side — policyEnabled (org
// override), effectiveEnabled (override > definition default), and
// accountEnabled — plus the composed verdict (`ready`, `needs_auth`,
// `disabled_by_org`, ...). This is what the UI renders, so T2-INT-1's
// "assert the composed value the UI shows" lands here.
export interface IntegrationHealthItemResult {
  definitionId: string;
  accountId: string | null;
  namespace: string;
  displayName: string;
  authKind: string;
  effectiveEnabled: boolean;
  policyEnabled: boolean | null;
  accountEnabled: boolean | null;
  health: string;
  tokenExpiresAt: string | null;
  toolCount: number | null;
  lastErrorCode: string | null;
}

export async function getIntegrationHealth(
  token: string,
  organizationId: string,
): Promise<ApiResult<{ items: IntegrationHealthItemResult[] }>> {
  return apiRequest<{ items: IntegrationHealthItemResult[] }>(
    `/v1/cloud/integrations/health?organizationId=${organizationId}`,
    { token },
  );
}

/** `DELETE /integrations/accounts/{accountId}` — disconnect. 204 on success. */
export async function removeIntegrationAccount(
  token: string,
  accountId: string,
): Promise<ApiResult<unknown>> {
  return apiRequest(`/v1/cloud/integrations/accounts/${accountId}`, {
    method: "DELETE",
    token,
  });
}

/**
 * Retry a read until it reflects a mutation that just returned. Same
 * class of lag `loginRightAfterMutation` (seed.ts) absorbs: the endpoint's
 * commit happens in `get_async_session`'s dependency teardown after the
 * response is written, so an immediate follow-up read on a fresh connection
 * can see the pre-mutation state for a beat. Observed directly on this
 * surface: a definitions-list read right after the enabled PATCH returned
 * the old policy value on the first attempt. Bounded and short — this
 * absorbs commit lag, it must never paper over a genuinely wrong state,
 * so the last attempt's value is returned for the caller to assert on
 * either way.
 */
export async function readUntil<T>(
  read: () => Promise<T>,
  settled: (value: T) => boolean,
  { tries = 20, delayMs = 150 }: { tries?: number; delayMs?: number } = {},
): Promise<T> {
  let last = await read();
  for (let i = 1; i < tries && !settled(last); i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await read();
  }
  return last;
}
