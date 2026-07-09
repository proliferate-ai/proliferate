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
