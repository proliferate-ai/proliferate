import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export type IntegrationAuthKind = "oauth2" | "api_key" | "none";
export type IntegrationSurface = "desktop" | "web";

export type IntegrationHealthVerdict =
  | "ready"
  | "needs_auth"
  | "needs_reauth"
  | "disabled_by_user"
  | "disabled_by_org"
  | "error";

// ---------------------------------------------------------------------------
// Connect catalog
// ---------------------------------------------------------------------------

export interface IntegrationCatalogSecretField {
  id: string;
  label: string;
  placeholder: string | null;
  helperText: string | null;
  prefixHint: string | null;
}

export interface IntegrationCatalogSettingOption {
  value: string;
  label: string;
}

export interface IntegrationCatalogSettingField {
  id: string;
  label: string;
  kind: "string" | "boolean" | "select" | "url";
  required: boolean;
  options: IntegrationCatalogSettingOption[];
  default: string | boolean | null;
}

export interface IntegrationConnectSchema {
  secretFields: IntegrationCatalogSecretField[];
  settingsFields: IntegrationCatalogSettingField[];
}

export interface IntegrationCatalogItem {
  definitionId: string;
  namespace: string;
  displayName: string;
  description: string | null;
  authKind: IntegrationAuthKind;
  connectSchema: IntegrationConnectSchema;
}

export interface IntegrationCatalogResponse {
  items: IntegrationCatalogItem[];
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface IntegrationHealthItem {
  definitionId: string;
  accountId: string | null;
  namespace: string;
  displayName: string;
  authKind: IntegrationAuthKind;
  effectiveEnabled: boolean;
  policyEnabled: boolean | null;
  accountEnabled: boolean | null;
  health: IntegrationHealthVerdict;
  tokenExpiresAt: string | null;
  toolCount: number | null;
  lastErrorCode: string | null;
}

export interface IntegrationHealthResponse {
  items: IntegrationHealthItem[];
}

// ---------------------------------------------------------------------------
// Authentication + accounts
// ---------------------------------------------------------------------------

export interface AuthenticateIntegrationRequest {
  definitionId: string;
  authKind: IntegrationAuthKind;
  apiKey?: string | null;
  settings?: Record<string, unknown> | null;
  callbackSurface?: IntegrationSurface | null;
  finalSurface?: IntegrationSurface | null;
  returnPath?: string | null;
}

export interface IntegrationAccount {
  accountId: string;
  definitionId: string;
  namespace: string;
  displayName: string;
  authKind: string;
  status: string;
  enabled: boolean;
}

export interface AuthenticateIntegrationResponse {
  account: IntegrationAccount | null;
  attemptId: string | null;
  attemptGeneration: number | null;
  oauthFlowId: string | null;
  authorizationUrl: string | null;
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// OAuth flows
// ---------------------------------------------------------------------------

export interface IntegrationOAuthFlowStatus {
  flowId: string;
  status: string;
  authorizationUrl: string | null;
  expiresAt: string;
  failureCode: string | null;
  callbackSurface: string;
  finalSurface: string;
}

// ---------------------------------------------------------------------------
// Authoritative management projection
// ---------------------------------------------------------------------------

export type IntegrationPrimaryAction =
  | "connect"
  | "reconnect"
  | "open_authorization"
  | "none";
export type IntegrationSecondaryAction = "cancel" | "disconnect";
export type IntegrationAttemptPurpose = "connect" | "reauthorize" | "rotate";
export type IntegrationAttemptStatus =
  | "active"
  | "exchanging"
  | "validating"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "superseded";

export interface IntegrationProviderAvailability {
  available: boolean;
  reason: string | null;
}

export interface IntegrationConnectionSummary {
  accountId: string;
  status: string;
  enabled: boolean;
  health: string;
  toolCount: number | null;
  tokenExpiresAt: string | null;
  lastErrorCode: string | null;
}

export interface IntegrationAuthorizationAttemptSummary {
  attemptId: string;
  purpose: IntegrationAttemptPurpose;
  method: IntegrationAuthKind;
  generation: number;
  status: IntegrationAttemptStatus;
  authorizationUrl: string | null;
  expiresAt: string;
  failureCode: string | null;
}

export interface IntegrationManagementActions {
  primary: IntegrationPrimaryAction;
  secondary: IntegrationSecondaryAction[];
}

export interface IntegrationManagementItem {
  definitionId: string;
  namespace: string;
  displayName: string;
  description: string | null;
  authKind: IntegrationAuthKind;
  connectSchema: IntegrationConnectSchema;
  availability: IntegrationProviderAvailability;
  connection: IntegrationConnectionSummary | null;
  attempt: IntegrationAuthorizationAttemptSummary | null;
  actions: IntegrationManagementActions;
}

export interface IntegrationManagementResponse {
  items: IntegrationManagementItem[];
}

export interface CancelIntegrationAuthorizationAttemptResponse {
  attempt: IntegrationAuthorizationAttemptSummary;
}

// ---------------------------------------------------------------------------
// Org-admin definition management
// ---------------------------------------------------------------------------

/**
 * How the auth kind of an org-custom definition was determined at creation:
 * the probe found an OAuth challenge ("detected"), found none ("none"),
 * could not reach the server ("unreachable"), or the admin chose explicitly
 * ("forced"). Only present on create responses.
 */
export type AdminIntegrationAuthDetection =
  | "detected"
  | "none"
  | "unreachable"
  | "forced";

export interface AdminIntegrationDefinition {
  definitionId: string;
  namespace: string;
  displayName: string;
  source: string;
  organizationId: string | null;
  authKind: string;
  enabledByDefault: boolean;
  policyEnabled: boolean | null;
  effectiveEnabled: boolean;
  authDetection?: AdminIntegrationAuthDetection | null;
}

export interface CreateAdminIntegrationDefinitionRequest {
  displayName: string;
  namespace: string;
  mcpUrl: string;
  /** "auto" (default) probes the MCP URL for an OAuth challenge. */
  authKind?: "auto" | "none" | "oauth2";
}

// ---------------------------------------------------------------------------
// User-facing calls
// ---------------------------------------------------------------------------

export interface IntegrationScopeOptions {
  organizationId?: string | null;
}

export async function getIntegrationCatalog(
  options: IntegrationScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationCatalogResponse> {
  return client.requestJson<IntegrationCatalogResponse>({
    method: "GET",
    path: "/v1/cloud/integrations/catalog",
    query: { organizationId: options.organizationId ?? undefined },
  });
}

export async function getIntegrationHealth(
  options: IntegrationScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationHealthResponse> {
  return client.requestJson<IntegrationHealthResponse>({
    method: "GET",
    path: "/v1/cloud/integrations/health",
    query: { organizationId: options.organizationId ?? undefined },
  });
}

export async function getIntegrationManagement(
  options: IntegrationScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationManagementResponse> {
  return client.requestJson<IntegrationManagementResponse>({
    method: "GET",
    path: "/v1/cloud/integrations/management",
    query: { organizationId: options.organizationId ?? undefined },
  });
}

export async function authenticateIntegration(
  body: AuthenticateIntegrationRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AuthenticateIntegrationResponse> {
  return client.requestJson<AuthenticateIntegrationResponse>({
    method: "POST",
    path: "/v1/cloud/integrations/authentications",
    body,
  });
}

export async function removeIntegrationAccount(
  accountId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<unknown>({
    method: "DELETE",
    path: "/v1/cloud/integrations/accounts/{account_id}",
    pathParams: { account_id: accountId },
  });
}

export async function getIntegrationOauthFlow(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationOAuthFlowStatus> {
  return client.requestJson<IntegrationOAuthFlowStatus>({
    method: "GET",
    path: "/v1/cloud/integrations/oauth/flows/{flow_id}",
    pathParams: { flow_id: flowId },
  });
}

export async function cancelIntegrationOauthFlow(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<IntegrationOAuthFlowStatus> {
  return client.requestJson<IntegrationOAuthFlowStatus>({
    method: "POST",
    path: "/v1/cloud/integrations/oauth/flows/{flow_id}/cancel",
    pathParams: { flow_id: flowId },
  });
}

export async function cancelIntegrationAuthorizationAttempt(
  attemptId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CancelIntegrationAuthorizationAttemptResponse> {
  return client.requestJson<CancelIntegrationAuthorizationAttemptResponse>({
    method: "POST",
    path: "/v1/cloud/integrations/authorization-attempts/{attempt_id}/cancel",
    pathParams: { attempt_id: attemptId },
  });
}

// ---------------------------------------------------------------------------
// Org-admin calls
// ---------------------------------------------------------------------------

export async function listAdminIntegrationDefinitions(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AdminIntegrationDefinition[]> {
  return client.requestJson<AdminIntegrationDefinition[]>({
    method: "GET",
    path: "/v1/cloud/integrations/admin/organizations/{organization_id}/definitions",
    pathParams: { organization_id: organizationId },
  });
}

export async function createAdminIntegrationDefinition(
  organizationId: string,
  body: CreateAdminIntegrationDefinitionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AdminIntegrationDefinition> {
  return client.requestJson<AdminIntegrationDefinition>({
    method: "POST",
    path: "/v1/cloud/integrations/admin/organizations/{organization_id}/definitions",
    pathParams: { organization_id: organizationId },
    body,
  });
}

export async function setAdminIntegrationEnabled(
  organizationId: string,
  definitionId: string,
  enabled: boolean,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AdminIntegrationDefinition> {
  return client.requestJson<AdminIntegrationDefinition>({
    method: "PATCH",
    path: "/v1/cloud/integrations/admin/organizations/{organization_id}/definitions/{definition_id}/enabled",
    pathParams: { organization_id: organizationId, definition_id: definitionId },
    body: { enabled },
  });
}
