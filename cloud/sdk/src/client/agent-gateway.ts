import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentApiKey,
  AgentAuthSelection,
  AgentAuthState,
  AgentAuthSurface,
  AgentGatewayCapabilities,
  AgentGatewayEnrollment,
  AgentModelOverride,
  AgentModels,
  CreateAgentApiKeyRequest,
  OrgAgentPolicy,
  OrgAgentPolicyViolationListResponse,
  PutAuthSelectionsRequest,
  UpdateOrgAgentPolicyRequest,
  UpsertAgentModelOverrideRequest,
} from "../types/index.js";

function selectionsPath(harnessKind: string): string {
  return `/v1/cloud/agent-auth/selections/${encodeURIComponent(harnessKind)}`;
}

// B4 re-key (model-catalog.md §Cloud routes): the cloud snapshot moved from
// /v1/cloud/agent-gateway/catalog/* to its own /v1/cloud/agent-models/*
// namespace, keyed by the catalog's own auth-context ids instead of the old
// coarse surface+route pair. Hard cutover, no alias window (F-040).
function agentModelsPath(harnessKind: string): string {
  return `/v1/cloud/agent-models/${encodeURIComponent(harnessKind)}`;
}

function orgAgentPolicyPath(organizationId: string): string {
  return `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/agent-auth/policy`;
}

// --- Key vault -------------------------------------------------------------

export async function listAgentApiKeys(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey[]> {
  return client.requestJson<AgentApiKey[]>({
    method: "GET",
    path: "/v1/cloud/agent-auth/keys",
  });
}

export async function createAgentApiKey(
  input: CreateAgentApiKeyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "POST",
    path: "/v1/cloud/agent-auth/keys",
    body: input,
  });
}

export async function revokeAgentApiKey(
  keyId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentApiKey> {
  return client.requestJson<AgentApiKey>({
    method: "DELETE",
    path: `/v1/cloud/agent-auth/keys/${encodeURIComponent(keyId)}`,
  });
}

// --- Auth selections -------------------------------------------------------

export async function listAuthSelections(
  surface?: AgentAuthSurface,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthSelection[]> {
  return client.requestJson<AgentAuthSelection[]>({
    method: "GET",
    path: "/v1/cloud/agent-auth/selections",
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
    path: "/v1/cloud/agent-auth/state",
    query: { surface },
  });
}

// --- Agent models (cloud snapshot) -----------------------------------------
//
// The layered read only: model-catalog.md's B4 re-key absorbed the old
// `refresh`/`mirror` product mutations into a single Worker-authenticated
// ingest route (`POST .../refresh`, `authenticate_worker`) that a signed-in
// product client cannot call — see server/proliferate/server/cloud/
// agent_models/api.py. There is no product-client-callable write function
// here; a manual "refresh" affordance returns in C3 once a real caller (the
// runtime-facing surface, not this SDK) exists (F-040).

export async function getAgentModels(
  harnessKind: string,
  authContextId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentModels> {
  return client.requestJson<AgentModels>({
    method: "GET",
    path: agentModelsPath(harnessKind),
    query: { authContextId },
  });
}

export async function upsertAgentModelOverride(
  harnessKind: string,
  input: UpsertAgentModelOverrideRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentModelOverride> {
  return client.requestJson<AgentModelOverride>({
    method: "PUT",
    path: `${agentModelsPath(harnessKind)}/override`,
    body: input,
  });
}

export async function deleteAgentModelOverride(
  harnessKind: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: `${agentModelsPath(harnessKind)}/override`,
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
