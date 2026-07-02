import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentApiKey,
  AgentApiKeyListResponse,
  AgentAuthRoute,
  AgentAuthRouteSelection,
  AgentAuthRouteSelectionListResponse,
  AgentAuthState,
  AgentAuthSurface,
  AgentGatewayCapabilities,
  AgentGatewayCatalog,
  AgentGatewayCatalogOverride,
  AgentGatewayEnrollment,
  CreateAgentApiKeyRequest,
  RefreshAgentGatewayCatalogRequest,
  UpsertAgentAuthRouteSelectionRequest,
  UpsertAgentGatewayCatalogOverrideRequest,
} from "../types/index.js";

function routeSelectionPath(harnessKind: string, surface: string): string {
  return `/v1/cloud/agent-gateway/route-selections/${encodeURIComponent(harnessKind)}/${encodeURIComponent(surface)}`;
}

function catalogPath(harnessKind: string): string {
  return `/v1/cloud/agent-gateway/catalog/${encodeURIComponent(harnessKind)}`;
}

export async function listAgentApiKeys(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKeyListResponse> {
  return client.requestJson<AgentApiKeyListResponse>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/api-keys",
  });
}

export async function createAgentApiKey(
  input: CreateAgentApiKeyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "POST",
    path: "/v1/cloud/agent-gateway/api-keys",
    body: input,
  });
}

export async function revokeAgentApiKey(
  keyId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "DELETE",
    path: `/v1/cloud/agent-gateway/api-keys/${encodeURIComponent(keyId)}`,
  });
}

export interface RouteSelectionScopeOptions {
  /**
   * Scope the operation to one enrolled direct runtime's override rows
   * (local surface only). Null/absent addresses the default rows
   * (target_id NULL) that every direct runtime inherits.
   */
  targetId?: string | null;
}

export async function listAgentRouteSelections(
  options: RouteSelectionScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthRouteSelectionListResponse> {
  return client.requestJson<AgentAuthRouteSelectionListResponse>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/route-selections",
    query: { targetId: options.targetId ?? undefined },
  });
}

/**
 * Every scope's selections in one list: the default rows plus each enrolled
 * runtime's override rows (disambiguated by `targetId`). For consumers that
 * reason across scopes, e.g. API-key usage summaries.
 */
export async function listAllAgentRouteSelections(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthRouteSelectionListResponse> {
  return client.requestJson<AgentAuthRouteSelectionListResponse>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/route-selections",
    query: { scope: "all" },
  });
}

export async function upsertAgentRouteSelection(
  harnessKind: string,
  surface: string,
  input: UpsertAgentAuthRouteSelectionRequest,
  options: RouteSelectionScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthRouteSelection> {
  return client.requestJson<AgentAuthRouteSelection>({
    method: "PUT",
    path: routeSelectionPath(harnessKind, surface),
    body: input,
    query: { targetId: options.targetId ?? undefined },
  });
}

export async function clearAgentRouteSelection(
  harnessKind: string,
  surface: string,
  slot: string = "primary",
  options: RouteSelectionScopeOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: routeSelectionPath(harnessKind, surface),
    query: { slot, targetId: options.targetId ?? undefined },
  });
}

export interface GetAgentAuthStateOptions {
  /**
   * Scope the local-surface document to one enrolled direct runtime
   * (per-target overrides rendered over the inherited defaults). Null/absent
   * fetches the default direct document.
   */
  targetId?: string | null;
}

export async function getAgentAuthState(
  surface: AgentAuthSurface,
  options: GetAgentAuthStateOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthState> {
  return client.requestJson<AgentAuthState>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/state",
    query: { surface, targetId: options.targetId ?? undefined },
  });
}

export async function getAgentCatalog(
  harnessKind: string,
  surface: AgentAuthSurface,
  route: AgentAuthRoute = "gateway",
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentGatewayCatalog> {
  return client.requestJson<AgentGatewayCatalog>({
    method: "GET",
    path: catalogPath(harnessKind),
    query: { surface, route },
  });
}

export async function refreshAgentCatalog(
  harnessKind: string,
  input: RefreshAgentGatewayCatalogRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentGatewayCatalog> {
  return client.requestJson<AgentGatewayCatalog>({
    method: "POST",
    path: `${catalogPath(harnessKind)}/refresh`,
    body: input,
  });
}

export async function upsertAgentCatalogOverride(
  harnessKind: string,
  input: UpsertAgentGatewayCatalogOverrideRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentGatewayCatalogOverride> {
  return client.requestJson<AgentGatewayCatalogOverride>({
    method: "PUT",
    path: `${catalogPath(harnessKind)}/override`,
    body: input,
  });
}

export async function deleteAgentCatalogOverride(
  harnessKind: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: `${catalogPath(harnessKind)}/override`,
  });
}

export async function getAgentGatewayCapabilities(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentGatewayCapabilities> {
  return client.requestJson<AgentGatewayCapabilities>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/capabilities",
  });
}

export async function getAgentGatewayEnrollment(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentGatewayEnrollment> {
  return client.requestJson<AgentGatewayEnrollment>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/enrollment",
  });
}
