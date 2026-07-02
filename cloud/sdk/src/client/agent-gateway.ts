import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentApiKey,
  AgentApiKeyListResponse,
  AgentAuthRouteSelection,
  AgentAuthRouteSelectionListResponse,
  AgentGatewayCapabilities,
  AgentGatewayEnrollment,
  CreateAgentApiKeyRequest,
  OrgAgentPolicy,
  OrgAgentPolicyViolationListResponse,
  UpdateOrgAgentPolicyRequest,
  UpsertAgentAuthRouteSelectionRequest,
} from "../types/index.js";

function routeSelectionPath(harnessKind: string, surface: string): string {
  return `/v1/cloud/agent-gateway/route-selections/${encodeURIComponent(harnessKind)}/${encodeURIComponent(surface)}`;
}

function orgAgentPolicyPath(organizationId: string): string {
  return `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/agent-gateway/policy`;
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

export async function listAgentRouteSelections(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthRouteSelectionListResponse> {
  return client.requestJson<AgentAuthRouteSelectionListResponse>({
    method: "GET",
    path: "/v1/cloud/agent-gateway/route-selections",
  });
}

export async function upsertAgentRouteSelection(
  harnessKind: string,
  surface: string,
  input: UpsertAgentAuthRouteSelectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthRouteSelection> {
  return client.requestJson<AgentAuthRouteSelection>({
    method: "PUT",
    path: routeSelectionPath(harnessKind, surface),
    body: input,
  });
}

export async function clearAgentRouteSelection(
  harnessKind: string,
  surface: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: routeSelectionPath(harnessKind, surface),
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
