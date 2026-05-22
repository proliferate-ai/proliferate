import type { components } from "../generated/openapi.js";

export type AgentAuthAgentKind = "claude" | "codex" | "opencode" | "gemini";
export type AgentAuthOwnerScope = "system" | "personal" | "organization";
export type SandboxProfileOwnerScope = "personal" | "organization";
export type AgentAuthCredentialKind = "managed_gateway" | "synced_path";
export type AgentGatewayProviderKind =
  | "anthropic_api_key"
  | "openai_api_key"
  | "bedrock_assume_role"
  | "openai_compatible";

export type AgentAuthCredential =
  components["schemas"]["AgentAuthCredentialResponse"];
export type AgentAuthCredentialShare =
  components["schemas"]["AgentAuthCredentialShareResponse"];
export type AgentAuthMutationResponse =
  components["schemas"]["AgentAuthMutationResponse"];
export type AgentGatewayPolicy =
  components["schemas"]["AgentGatewayPolicyResponse"];
export type AgentGatewayProviderCredential =
  components["schemas"]["AgentGatewayProviderCredentialResponse"];
export type AgentGatewayBudgetSubject =
  components["schemas"]["AgentGatewayBudgetSubjectResponse"];
export type CreateGatewayCredentialRequest =
  components["schemas"]["CreateGatewayCredentialRequest"];
export type CreateGatewayCredentialResponse =
  components["schemas"]["CreateGatewayCredentialResponse"];
export type SyncSyncedCredentialRequest =
  | components["schemas"]["SyncSyncedCredentialEnvRequest"]
  | components["schemas"]["SyncSyncedCredentialFileRequest"];
export type SyncSyncedCredentialResponse =
  components["schemas"]["SyncSyncedCredentialResponse"];
export type EnsureManagedCreditsRequest =
  components["schemas"]["EnsureManagedCreditsRequest"];
export type EnsureManagedCreditsResponse =
  components["schemas"]["EnsureManagedCreditsResponse"];
export type SandboxProfile =
  components["schemas"]["SandboxProfileResponse"];
export type SandboxAgentAuthSelection =
  components["schemas"]["SandboxAgentAuthSelectionResponse"];
export type SandboxAgentAuthTargetState =
  components["schemas"]["SandboxProfileAgentAuthTargetStateResponse"];

export interface AgentAuthCredentialListOptions {
  organizationId?: string | null;
  agentKind?: AgentAuthAgentKind | null;
}

export interface AgentAuthCredentialOwnerInput {
  ownerScope: SandboxProfileOwnerScope;
  organizationId?: string | null;
  displayName: string;
}

export interface CreateAnthropicApiKeyCredentialInput
  extends AgentAuthCredentialOwnerInput {
  apiKey: string;
}

export interface CreateOpenAiApiKeyCredentialInput
  extends AgentAuthCredentialOwnerInput {
  agentKind: Extract<AgentAuthAgentKind, "codex" | "opencode">;
  apiKey: string;
}

export interface CreateOpenAiCompatibleCredentialInput
  extends AgentAuthCredentialOwnerInput {
  agentKind: Extract<AgentAuthAgentKind, "codex" | "opencode">;
  baseUrl: string;
  apiKey: string;
}

export interface CreateBedrockAssumeRoleCredentialInput
  extends AgentAuthCredentialOwnerInput {
  roleArn: string;
  region: string;
  externalId: string;
}

export interface SelectAgentAuthCredentialInput {
  credentialId: string;
  credentialShareId?: string | null;
  forceRestart?: boolean;
}

export type AgentGatewayCapabilities =
  components["schemas"]["AgentGatewayCapabilities"];
export type CloudCapabilities =
  components["schemas"]["CloudCapabilitiesResponse"];
