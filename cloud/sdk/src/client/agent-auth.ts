import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialListOptions,
  AgentAuthCredentialShare,
  AgentAuthMutationResponse,
  CreateAnthropicApiKeyCredentialInput,
  CreateBedrockAssumeRoleCredentialInput,
  CreateGatewayCredentialRequest,
  CreateGatewayCredentialResponse,
  CreateOpenAiApiKeyCredentialInput,
  CreateOpenAiCompatibleCredentialInput,
  EnsureManagedCreditsRequest,
  EnsureManagedCreditsResponse,
  EnsureSandboxProfileInput,
  SandboxAgentAuthSelection,
  SandboxAgentAuthTargetState,
  SandboxProfile,
  SelectAgentAuthCredentialInput,
} from "../types/index.js";

export async function listAgentAuthCredentials(
  options: AgentAuthCredentialListOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthCredential[]> {
  return client.requestJson<AgentAuthCredential[]>({
    method: "GET",
    path: "/v1/cloud/agent-auth/credentials",
    query: {
      organizationId: options.organizationId,
      agentKind: options.agentKind,
    },
  });
}

export async function createGatewayCredential(
  body: CreateGatewayCredentialRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CreateGatewayCredentialResponse> {
  return client.requestJson<CreateGatewayCredentialResponse>({
    method: "POST",
    path: "/v1/cloud/agent-auth/credentials/gateway",
    body,
  });
}

export function createAnthropicApiKeyCredential(
  input: CreateAnthropicApiKeyCredentialInput,
  client?: ProliferateCloudClient,
): Promise<CreateGatewayCredentialResponse> {
  return createGatewayCredential(
    {
      ownerScope: input.ownerScope,
      organizationId: input.organizationId ?? null,
      agentKind: "claude",
      displayName: input.displayName,
      policyKind: policyKindForOwner(input.ownerScope),
      providerKind: "anthropic_api_key",
      payload: { apiKey: input.apiKey },
    },
    client,
  );
}

export function createOpenAiApiKeyCredential(
  input: CreateOpenAiApiKeyCredentialInput,
  client?: ProliferateCloudClient,
): Promise<CreateGatewayCredentialResponse> {
  return createGatewayCredential(
    {
      ownerScope: input.ownerScope,
      organizationId: input.organizationId ?? null,
      agentKind: input.agentKind,
      displayName: input.displayName,
      policyKind: policyKindForOwner(input.ownerScope),
      providerKind: "openai_api_key",
      payload: { apiKey: input.apiKey },
    },
    client,
  );
}

export function createOpenAiCompatibleCredential(
  input: CreateOpenAiCompatibleCredentialInput,
  client?: ProliferateCloudClient,
): Promise<CreateGatewayCredentialResponse> {
  return createGatewayCredential(
    {
      ownerScope: input.ownerScope,
      organizationId: input.organizationId ?? null,
      agentKind: input.agentKind,
      displayName: input.displayName,
      policyKind: policyKindForOwner(input.ownerScope),
      providerKind: "openai_compatible",
      payload: {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      },
    },
    client,
  );
}

export function createBedrockAssumeRoleCredential(
  input: CreateBedrockAssumeRoleCredentialInput,
  client?: ProliferateCloudClient,
): Promise<CreateGatewayCredentialResponse> {
  return createGatewayCredential(
    {
      ownerScope: input.ownerScope,
      organizationId: input.organizationId ?? null,
      agentKind: "claude",
      displayName: input.displayName,
      policyKind: policyKindForOwner(input.ownerScope),
      providerKind: "bedrock_assume_role",
      payload: {
        roleArn: input.roleArn,
        region: input.region,
        externalId: input.externalId,
      },
    },
    client,
  );
}

export async function deleteAgentAuthCredential(
  credentialId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthMutationResponse> {
  return client.requestJson<AgentAuthMutationResponse>({
    method: "DELETE",
    path: "/v1/cloud/agent-auth/credentials/{credential_id}",
    pathParams: { credential_id: credentialId },
  });
}

export async function createAgentAuthCredentialShare(
  credentialId: string,
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthCredentialShare> {
  return client.requestJson<AgentAuthCredentialShare>({
    method: "POST",
    path: "/v1/cloud/agent-auth/credentials/{credential_id}/shares",
    pathParams: { credential_id: credentialId },
    body: { organizationId },
  });
}

export async function deleteAgentAuthCredentialShare(
  shareId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthCredentialShare> {
  return client.requestJson<AgentAuthCredentialShare>({
    method: "DELETE",
    path: "/v1/cloud/agent-auth/credential-shares/{share_id}",
    pathParams: { share_id: shareId },
  });
}

export async function ensurePersonalSandboxProfile(
  input: EnsureSandboxProfileInput = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfile> {
  return client.requestJson<SandboxProfile>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/personal",
    body: { managedTargetId: input.managedTargetId ?? null },
  });
}

export async function ensureOrganizationSandboxProfile(
  organizationId: string,
  input: EnsureSandboxProfileInput = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfile> {
  return client.requestJson<SandboxProfile>({
    method: "POST",
    path: "/v1/cloud/organizations/{organization_id}/sandbox-profile",
    pathParams: { organization_id: organizationId },
    body: { managedTargetId: input.managedTargetId ?? null },
  });
}

export async function getSandboxAgentAuthSelections(
  sandboxProfileId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxAgentAuthSelection[]> {
  return client.requestJson<SandboxAgentAuthSelection[]>({
    method: "GET",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections",
    pathParams: { sandbox_profile_id: sandboxProfileId },
  });
}

export async function putSandboxAgentAuthSelection(
  sandboxProfileId: string,
  agentKind: AgentAuthAgentKind,
  input: SelectAgentAuthCredentialInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxAgentAuthSelection> {
  return client.requestJson<SandboxAgentAuthSelection>({
    method: "PUT",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections/{agent_kind}",
    pathParams: {
      sandbox_profile_id: sandboxProfileId,
      agent_kind: agentKind,
    },
    body: {
      credentialId: input.credentialId,
      credentialShareId: input.credentialShareId ?? null,
      forceRestart: input.forceRestart ?? false,
    },
  });
}

export async function getSandboxAgentAuthTargetStates(
  sandboxProfileId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxAgentAuthTargetState[]> {
  return client.requestJson<SandboxAgentAuthTargetState[]>({
    method: "GET",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-target-states",
    pathParams: { sandbox_profile_id: sandboxProfileId },
  });
}

export async function ensureManagedCreditsForOrganization(
  organizationId: string,
  input: EnsureManagedCreditsRequest = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<EnsureManagedCreditsResponse> {
  return client.requestJson<EnsureManagedCreditsResponse>({
    method: "POST",
    path: "/v1/cloud/organizations/{organization_id}/agent-auth/managed-credits",
    pathParams: { organization_id: organizationId },
    body: input,
  });
}

function policyKindForOwner(
  ownerScope: CreateGatewayCredentialRequest["ownerScope"],
): CreateGatewayCredentialRequest["policyKind"] {
  return ownerScope === "organization" ? "org_byok" : "personal_byok";
}
