import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialListOptions,
  AgentAuthCredentialProviderId,
  AgentAuthCredentialShare,
  AgentAuthMutationResponse,
  CloudCapabilities,
  CreateAnthropicApiKeyCredentialInput,
  CreateBedrockAssumeRoleCredentialInput,
  CreateGeminiApiKeyCredentialInput,
  CreateGatewayCredentialRequest,
  CreateGatewayCredentialResponse,
  CreateOpenAiApiKeyCredentialInput,
  CreateOpenAiCompatibleCredentialInput,
  EnsureFreeManagedCreditsRequest,
  EnsureFreeManagedCreditsResponse,
  EnsureManagedCreditsRequest,
  EnsureManagedCreditsResponse,
  SandboxAgentAuthSelection,
  SandboxAgentAuthTargetState,
  SandboxProfile,
  SandboxProfileTargetState,
  SelectAgentAuthCredentialInput,
  SyncSyncedCredentialRequest,
  SyncSyncedCredentialResponse,
} from "../types/index.js";

export async function getCloudCapabilities(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudCapabilities> {
  return client.requestJson<CloudCapabilities>({
    method: "GET",
    path: "/v1/cloud/capabilities",
  });
}

export async function listAgentAuthCredentials(
  options: AgentAuthCredentialListOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthCredential[]> {
  return client.requestJson<AgentAuthCredential[]>({
    method: "GET",
    path: "/v1/cloud/agent-auth/credentials",
    query: {
      organizationId: options.organizationId,
      credentialProviderId: options.credentialProviderId,
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

export async function syncSyncedAgentAuthCredential(
  agentKind: Extract<AgentAuthAgentKind, "claude" | "codex" | "gemini">,
  body: SyncSyncedCredentialRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SyncSyncedCredentialResponse> {
  return client.requestJson<SyncSyncedCredentialResponse>({
    method: "PUT",
    path: "/v1/cloud/agent-auth/credentials/synced/{agent_kind}",
    pathParams: { agent_kind: agentKind },
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
      credentialProviderId: "anthropic",
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
      credentialProviderId: "openai",
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
      credentialProviderId: "openai",
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

export function createGeminiApiKeyCredential(
  input: CreateGeminiApiKeyCredentialInput,
  client?: ProliferateCloudClient,
): Promise<CreateGatewayCredentialResponse> {
  return createGatewayCredential(
    {
      ownerScope: input.ownerScope,
      organizationId: input.organizationId ?? null,
      credentialProviderId: "gemini",
      displayName: input.displayName,
      policyKind: policyKindForOwner(input.ownerScope),
      providerKind: "gemini_api_key",
      payload: { apiKey: input.apiKey },
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
      credentialProviderId: "anthropic",
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
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfile> {
  return client.requestJson<SandboxProfile>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/personal",
  });
}

export async function ensureOrganizationSandboxProfile(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfile> {
  return client.requestJson<SandboxProfile>({
    method: "POST",
    path: "/v1/cloud/organizations/{organization_id}/sandbox-profile",
    pathParams: { organization_id: organizationId },
  });
}

export async function getSandboxProfileTargetState(
  sandboxProfileId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfileTargetState> {
  return client.requestJson<SandboxProfileTargetState>({
    method: "GET",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/target-state",
    pathParams: { sandbox_profile_id: sandboxProfileId },
  });
}

export async function enableSandboxProfileCloud(
  sandboxProfileId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxProfileTargetState> {
  return client.requestJson<SandboxProfileTargetState>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/enable-cloud",
    pathParams: { sandbox_profile_id: sandboxProfileId },
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
  authSlotId: AgentAuthCredentialProviderId | string,
  input: SelectAgentAuthCredentialInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SandboxAgentAuthSelection> {
  return client.requestJson<SandboxAgentAuthSelection>({
    method: "PUT",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections/{agent_kind}/{auth_slot_id}",
    pathParams: {
      sandbox_profile_id: sandboxProfileId,
      agent_kind: agentKind,
      auth_slot_id: authSlotId,
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

export interface DesktopAgentAuthConfigApplyRequestInput {
  targetId?: string | null;
}

export interface DesktopAgentAuthConfigApplyRequestResponse {
  applyRequest: Record<string, unknown>;
  syncedFiles?: Array<{
    relativePath: string;
    content: string;
  }>;
}

export interface DesktopAgentAuthConfigApplyStatusInput {
  targetId?: string | null;
  revision: number;
  status: string;
  applied?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function getSandboxProfileDesktopAgentAuthConfigApplyRequest(
  sandboxProfileId: string,
  body: DesktopAgentAuthConfigApplyRequestInput = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DesktopAgentAuthConfigApplyRequestResponse> {
  return client.requestJson<DesktopAgentAuthConfigApplyRequestResponse>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-config/desktop-apply-request",
    pathParams: { sandbox_profile_id: sandboxProfileId },
    body,
  });
}

export async function recordSandboxProfileDesktopAgentAuthConfigApplyStatus(
  sandboxProfileId: string,
  body: DesktopAgentAuthConfigApplyStatusInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AgentAuthMutationResponse> {
  return client.requestJson<AgentAuthMutationResponse>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/agent-auth-config/desktop-apply-status",
    pathParams: { sandbox_profile_id: sandboxProfileId },
    body: {
      targetId: body.targetId ?? null,
      revision: body.revision,
      status: body.status,
      applied: body.applied ?? true,
      errorCode: body.errorCode ?? null,
      errorMessage: body.errorMessage ?? null,
    },
  });
}

export async function ensureFreeManagedCredits(
  input: EnsureFreeManagedCreditsRequest = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<EnsureFreeManagedCreditsResponse> {
  return client.requestJson<EnsureFreeManagedCreditsResponse>({
    method: "POST",
    path: "/v1/cloud/agent-auth/free-credits/ensure",
    body: input,
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
