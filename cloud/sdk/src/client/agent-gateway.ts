import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentApiKey,
  AgentAuthRoute,
  AgentAuthSelection,
  AgentAuthState,
  AgentAuthSurface,
  AgentGatewayCapabilities,
  AgentGatewayCatalog,
  AgentGatewayCatalogOverride,
  AgentGatewayEnrollment,
  CreateAgentApiKeyRequest,
  OrgAgentPolicy,
  OrgAgentPolicyViolationListResponse,
  PutAuthSelectionsRequest,
  RefreshAgentGatewayCatalogRequest,
  UpdateOrgAgentPolicyRequest,
  UpsertAgentGatewayCatalogOverrideRequest,
} from "../types/index.js";

function selectionsPath(harnessKind: string): string {
  return `/v1/cloud/agent-gateway/selections/${encodeURIComponent(harnessKind)}`;
}

function catalogPath(harnessKind: string): string {
  return `/v1/cloud/agent-gateway/catalog/${encodeURIComponent(harnessKind)}`;
}

function orgAgentPolicyPath(organizationId: string): string {
  return `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/agent-gateway/policy`;
}

// --- Key vault -------------------------------------------------------------

export async function listAgentApiKeys(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey[]> {
  return client.requestJson<AgentApiKey[]>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/keys",
  });
}

export async function createAgentApiKey(
  input: CreateAgentApiKeyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "POST",
    path: "/v1/cloud/agent-gateway/keys",
    body: input,
  });
}

export async function revokeAgentApiKey(
  keyId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "DELETE",
    path: `/v1/cloud/agent-gateway/keys/${encodeURIComponent(keyId)}`,
  });
}

// --- Auth selections -------------------------------------------------------

export async function listAuthSelections(
  surface?: AgentAuthSurface,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthSelection[]> {
  return client.requestJson<AgentAuthSelection[]>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/selections",
    query: surface ? { surface } : undefined,
  });
}

export async function putAuthSelections(
  harnessKind: string,
  surface: AgentAuthSurface,
  input: PutAuthSelectionsRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthSelection[]> {
  return client.requestJson<AgentAuthSelection[]>({
    method: "PUT",
    path: selectionsPath(harnessKind),
    query: { surface },
    body: input,
  });
}

export async function getAgentAuthState(
  surface: AgentAuthSurface,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthState> {
  return client.requestJson<AgentAuthState>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/state",
    query: { surface },
  });
}

// --- Catalog ---------------------------------------------------------------

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

// --- Capabilities + enrollment --------------------------------------------

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

// --- Org policy ------------------------------------------------------------

export async function getOrgAgentPolicy(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgAgentPolicy> {
  return client.requestJson<OrgAgentPolicy>({
    method: "GET",
    path: orgAgentPolicyPath(organizationId),
  });
}

export async function updateOrgAgentPolicy(
  organizationId: string,
  input: UpdateOrgAgentPolicyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgAgentPolicy> {
  return client.requestJson<OrgAgentPolicy>({
    method: "PUT",
    path: orgAgentPolicyPath(organizationId),
    body: input,
  });
}

export async function listOrgAgentPolicyViolations(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgAgentPolicyViolationListResponse> {
  return client.requestJson<OrgAgentPolicyViolationListResponse>({
    method: "GET",
    path: `${orgAgentPolicyPath(organizationId)}/violations`,
  });
}
