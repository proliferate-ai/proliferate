import type { Schema } from "./schema.js";

export type AgentAuthAgentKind = "claude" | "codex" | "opencode" | "gemini" | "grok";
export type AgentAuthCredentialProviderId = "anthropic" | "openai" | "gemini" | "cursor" | "xai";
export type AgentAuthOwnerScope = "system" | "personal" | "organization";
export type SandboxProfileOwnerScope = "personal" | "organization";
export type AgentAuthCredentialKind = "managed_gateway" | "synced_path";
export type AgentGatewayProviderKind =
  | "anthropic_api_key"
  | "openai_api_key"
  | "gemini_api_key"
  | "bedrock_assume_role"
  | "openai_compatible";

export type AgentAuthCredential =
  Schema<"AgentAuthCredentialResponse">;
export type AgentAuthCredentialShare =
  Schema<"AgentAuthCredentialShareResponse">;
export type AgentAuthMutationResponse =
  Schema<"AgentAuthMutationResponse">;
export type AgentGatewayPolicy =
  Schema<"AgentGatewayPolicyResponse">;
export type AgentGatewayProviderCredential =
  Schema<"AgentGatewayProviderCredentialResponse">;
export type AgentGatewayBudgetSubject =
  Schema<"AgentGatewayBudgetSubjectResponse">;
export type AgentGatewayFreeCreditEntitlement =
  Schema<"AgentGatewayFreeCreditEntitlementResponse">;
export type CreateGatewayCredentialRequest =
  Schema<"CreateGatewayCredentialRequest">;
export type CreateGatewayCredentialResponse =
  Schema<"CreateGatewayCredentialResponse">;
export type SyncSyncedCredentialRequest =
  | Schema<"SyncSyncedCredentialEnvRequest">
  | Schema<"SyncSyncedCredentialFileRequest">;
export type SyncSyncedCredentialResponse =
  Schema<"SyncSyncedCredentialResponse">;
export type EnsureManagedCreditsRequest =
  Schema<"EnsureManagedCreditsRequest">;
export type EnsureManagedCreditsResponse =
  Schema<"EnsureManagedCreditsResponse">;
export type EnsureFreeManagedCreditsRequest =
  Schema<"EnsureFreeManagedCreditsRequest">;
export type EnsureFreeManagedCreditsResponse =
  Schema<"EnsureFreeManagedCreditsResponse">;
export type SandboxProfile =
  Schema<"SandboxProfileResponse">;
export type SandboxProfileTargetState =
  Schema<"SandboxProfileTargetStateResponse">;
export type SandboxAgentAuthSelection =
  Schema<"SandboxAgentAuthSelectionResponse">;
export type SandboxAgentAuthTargetState =
  Schema<"SandboxProfileAgentAuthTargetStateResponse">;

export interface AgentAuthCredentialListOptions {
  organizationId?: string | null;
  credentialProviderId?: AgentAuthCredentialProviderId | null;
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
  apiKey: string;
}

export interface CreateOpenAiCompatibleCredentialInput
  extends AgentAuthCredentialOwnerInput {
  baseUrl: string;
  apiKey: string;
}

export interface CreateGeminiApiKeyCredentialInput
  extends AgentAuthCredentialOwnerInput {
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
  Schema<"AgentGatewayCapabilities">;
export type CloudCapabilities =
  Schema<"CloudCapabilitiesResponse">;
