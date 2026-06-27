import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export type IntegrationAuthKind = "oauth2" | "api_key" | "none";
export type IntegrationOAuthFlowStatus =
  | "active"
  | "exchanging"
  | "completed"
  | "expired"
  | "cancelled"
  | "failed";
export type IntegrationStatus =
  | "ready"
  | "setup_required"
  | "reauth_required"
  | "refreshing"
  | "disabled"
  | "unavailable"
  | "error";

export interface IntegrationAuthMode {
  kind: IntegrationAuthKind;
  clientStrategy?: "dcr" | "client_metadata_document" | "static" | null;
  label?: string | null;
}

export interface IntegrationSetting {
  id: string;
  label: string;
  default: string;
  options: Array<{
    value: string;
    label: string;
  }>;
}

export interface IntegrationDefinition {
  id: string;
  key: string;
  source: "seed" | "org_custom";
  organizationId: string | null;
  displayName: string;
  namespace: string;
  providerGroup: string | null;
  transport: "http";
  implementation: "upstream_mcp" | "virtual_proliferate_mcp";
  enabledByDefault: boolean;
  authModes: IntegrationAuthMode[];
  settings: IntegrationSetting[];
  flags: Record<string, unknown>;
  iconId: string | null;
  toolSurfaceKind: string;
  archivedAt: string | null;
}

export interface CreateIntegrationDefinitionRequest {
  organizationId: string;
  displayName: string;
  namespace: string;
  mcpUrl: string;
}

export interface IntegrationAccount {
  id: string;
  definitionId: string;
  ownerScope: "personal" | "organization";
  ownerUserId: string | null;
  organizationId: string | null;
  authKind: IntegrationAuthKind;
  status: IntegrationStatus;
  settings: Record<string, unknown>;
  authVersion: number;
  tokenExpiresAt: string | null;
  lastErrorCode: string | null;
  enabled: boolean;
  definition: IntegrationDefinition;
}

export interface CreateIntegrationAccountRequest {
  definitionId: string;
  authKind: IntegrationAuthKind;
  apiKey?: string | null;
  settings?: Record<string, unknown> | null;
}

export interface PatchIntegrationAccountRequest {
  enabled?: boolean | null;
  apiKey?: string | null;
  settings?: Record<string, unknown> | null;
}

export interface StartIntegrationOAuthFlowRequest {
  callbackSurface?: "desktop" | "web" | null;
  finalSurface?: "desktop" | "web" | null;
  returnPath?: string | null;
  clientStrategy?: "dcr" | "client_metadata_document" | "static" | null;
}

export interface StartIntegrationOAuthFlowResponse {
  flowId: string;
  status: IntegrationOAuthFlowStatus;
  authorizationUrl: string;
  expiresAt: string;
}

export interface IntegrationOAuthFlowStatusResponse {
  flowId: string;
  status: IntegrationOAuthFlowStatus;
  authorizationUrl: string | null;
  failureCode: string | null;
  expiresAt: string;
  callbackSurface: string;
  finalSurface: string;
}

export interface IntegrationAvailability {
  definitionId: string;
  accountId: string | null;
  namespace: string;
  displayName: string;
  iconId: string | null;
  status: IntegrationStatus;
  authModes: IntegrationAuthKind[];
  selectedAuthKind: IntegrationAuthKind | null;
  toolCount: number | null;
  reconnectUrl: string | null;
  lastErrorCode: string | null;
}

export interface IntegrationToolMetadata {
  namespace: string;
  displayName: string;
  iconId: string | null;
  tools: Array<{
    gatewayToolName: string;
    upstreamToolName: string;
    displayName: string;
  }>;
}

export async function listIntegrationDefinitions(
  input: { organizationId?: string | null } = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationDefinition[]> {
  return await client.requestJson({
    method: "GET",
    path: "/v1/cloud/integrations/definitions",
    query: { organizationId: input.organizationId ?? null },
  });
}

export async function createIntegrationDefinition(
  body: CreateIntegrationDefinitionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationDefinition> {
  return await client.requestJson({
    method: "POST",
    path: "/v1/cloud/integrations/definitions",
    body,
  });
}

export async function listIntegrationAccounts(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationAccount[]> {
  return await client.requestJson({
    method: "GET",
    path: "/v1/cloud/integrations/accounts",
  });
}

export async function createIntegrationAccount(
  body: CreateIntegrationAccountRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationAccount> {
  return await client.requestJson({
    method: "POST",
    path: "/v1/cloud/integrations/accounts",
    body,
  });
}

export async function patchIntegrationAccount(
  accountId: string,
  body: PatchIntegrationAccountRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationAccount> {
  return await client.requestJson({
    method: "PATCH",
    path: `/v1/cloud/integrations/accounts/${encodeURIComponent(accountId)}`,
    body,
  });
}

export async function deleteIntegrationAccount(
  accountId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson({
    method: "DELETE",
    path: `/v1/cloud/integrations/accounts/${encodeURIComponent(accountId)}`,
  });
}

export async function startIntegrationOAuthFlow(
  accountId: string,
  body: StartIntegrationOAuthFlowRequest = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<StartIntegrationOAuthFlowResponse> {
  return await client.requestJson({
    method: "POST",
    path: `/v1/cloud/integrations/accounts/${encodeURIComponent(accountId)}/oauth/start`,
    body,
  });
}

export async function getIntegrationOAuthFlowStatus(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationOAuthFlowStatusResponse> {
  return await client.requestJson({
    method: "GET",
    path: `/v1/cloud/integrations/oauth/flows/${encodeURIComponent(flowId)}`,
  });
}

export async function cancelIntegrationOAuthFlow(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationOAuthFlowStatusResponse> {
  return await client.requestJson({
    method: "POST",
    path: `/v1/cloud/integrations/oauth/flows/${encodeURIComponent(flowId)}/cancel`,
  });
}

export async function listIntegrationAvailability(
  input: { organizationId?: string | null } = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationAvailability[]> {
  return await client.requestJson({
    method: "GET",
    path: "/v1/cloud/integrations/availability",
    query: { organizationId: input.organizationId ?? null },
  });
}

export async function listIntegrationToolMetadata(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationToolMetadata[]> {
  return await client.requestJson({
    method: "GET",
    path: "/v1/cloud/integrations/tool-metadata",
  });
}
