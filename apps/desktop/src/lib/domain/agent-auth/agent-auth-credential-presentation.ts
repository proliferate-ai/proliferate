import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthTargetState,
} from "@proliferate/cloud-sdk";
import { agentAuthCredentialProviderLabel } from "./auth-slots";
import { gatewayByokCredentialEnabled } from "./agent-auth-gateway-capabilities";

export type AgentAuthBadgeTone = "neutral" | "success" | "warning" | "destructive";
export type AgentAuthCredentialAvailabilityStatus = "available" | "unavailable";
export type AgentAuthCredentialSection =
  | "managed_credits"
  | "organization_credentials"
  | "personal_credentials"
  | "shared_personal_credentials";

export interface AgentAuthCredentialAvailability {
  status: AgentAuthCredentialAvailabilityStatus;
  label: string;
  reason: string | null;
}

export function agentAuthCredentialKindLabel(credential: AgentAuthCredential): string {
  if (credential.credentialKind === "managed_gateway") {
    const providerKind = credential.redactedSummary.providerKind;
    if (isProliferateManagedGatewayProviderKind(providerKind)) {
      return "Proliferate managed credits";
    }
    if (providerKind === "bedrock_assume_role") {
      return "AWS Bedrock role";
    }
    if (providerKind === "anthropic_api_key") {
      return "Anthropic API key";
    }
    if (providerKind === "openai_api_key") {
      return "OpenAI API key";
    }
    if (providerKind === "gemini_api_key") {
      return "Gemini API key";
    }
    if (providerKind === "openai_compatible") {
      return "OpenAI-compatible provider";
    }
    return "Gateway credential";
  }
  if (credential.credentialKind === "synced_path") {
    return `Synced ${agentAuthCredentialProviderLabel(credential.credentialProviderId)} auth`;
  }
  return credential.credentialKind;
}

export function agentAuthCredentialOwnerLabel(credential: AgentAuthCredential): string {
  if (credential.ownerScope === "system") {
    return "System";
  }
  if (credential.ownerScope === "organization") {
    return "Organization";
  }
  return "Personal";
}

export function agentAuthCredentialDisplayLabel(credential: AgentAuthCredential): string {
  if (
    isProliferateManagedCreditsCredential(credential)
    && credential.ownerScope === "personal"
  ) {
    return "Proliferate Default Free credits";
  }
  return credential.displayName;
}

export function agentAuthCredentialStatusTone(status: string): AgentAuthBadgeTone {
  if (status === "ready" || status === "active" || status === "applied") {
    return "success";
  }
  if (
    status === "pending"
    || status === "syncing"
    || status === "materializing"
    || status === "needs_resync"
    || status === "needs_reauth"
  ) {
    return "warning";
  }
  if (
    status === "revoked"
    || status === "invalid"
    || status === "invalid_config"
    || status === "failed"
    || status === "blocked"
    || status === "exhausted"
    || status === "unavailable"
  ) {
    return "destructive";
  }
  return "neutral";
}

export function agentAuthCredentialStatusLabel(status: string): string {
  if (status === "needs_resync") {
    return "Needs resync";
  }
  return status.replaceAll("_", " ");
}

export function describeAgentAuthCredential(credential: AgentAuthCredential): string {
  const details = credentialSummaryDetails(credential);
  const owner = agentAuthCredentialOwnerLabel(credential);
  return details ? `${owner} · ${details}` : owner;
}

export function agentAuthCredentialAvailability(
  credential: AgentAuthCredential,
  capabilities: AgentGatewayCapabilities | null | undefined,
): AgentAuthCredentialAvailability {
  if (credential.credentialKind === "synced_path") {
    return {
      status: "available",
      label: "Available",
      reason: null,
    };
  }
  if (isProliferateManagedCreditsCredential(credential)) {
    if (capabilities && !capabilities.enabled) {
      return {
        status: "unavailable",
        label: "Gateway unavailable",
        reason: "Proliferate Gateway is disabled for this deployment.",
      };
    }
    if (
      capabilities
      && !capabilities.managedCreditsPersonalEnabled
      && !capabilities.managedCreditsOrganizationEnabled
    ) {
      return {
        status: "unavailable",
        label: "Credits unavailable",
        reason: "Managed credits are not enabled for this deployment.",
      };
    }
    return {
      status: "available",
      label: "Managed credits",
      reason: null,
    };
  }
  if (gatewayByokCredentialEnabled(credential, capabilities)) {
    return {
      status: "available",
      label: "BYOK enabled",
      reason: null,
    };
  }
  return {
    status: "unavailable",
    label: "Unavailable in hosted cloud",
    reason: "BYOK provider credentials are hidden unless the deployment enables the matching capability.",
  };
}

export function isHostedCloudV1AgentAuthCredential(credential: AgentAuthCredential): boolean {
  if (credential.credentialKind === "synced_path") {
    return true;
  }
  return isProliferateManagedCreditsCredential(credential);
}

export function isAgentAuthCredentialVisibleForCapabilities(
  credential: AgentAuthCredential,
  capabilities: AgentGatewayCapabilities | null | undefined,
): boolean {
  if (credential.credentialKind === "synced_path") {
    return true;
  }
  if (isProliferateManagedCreditsCredential(credential)) {
    return true;
  }
  return gatewayByokCredentialEnabled(credential, capabilities);
}

export function agentAuthCredentialSection(
  credential: AgentAuthCredential,
): AgentAuthCredentialSection {
  if (isProliferateManagedCreditsCredential(credential)) {
    return "managed_credits";
  }
  if (credential.ownerScope === "organization") {
    return "organization_credentials";
  }
  if (credential.activeCredentialShareId) {
    return "shared_personal_credentials";
  }
  return "personal_credentials";
}

export function agentAuthCredentialSectionLabel(
  section: AgentAuthCredentialSection,
): string {
  if (section === "managed_credits") {
    return "Proliferate managed credits";
  }
  if (section === "organization_credentials") {
    return "Organization credentials";
  }
  if (section === "shared_personal_credentials") {
    return "Shared personal credentials";
  }
  return "Personal credentials";
}

export function agentAuthCredentialShareLabel(
  credential: AgentAuthCredential,
  currentUserId: string | null,
): string | null {
  if (credential.ownerScope !== "personal" || credential.credentialKind !== "synced_path") {
    return null;
  }
  if (credential.activeCredentialShareId) {
    return credential.ownerUserId === currentUserId
      ? "Shared with organization"
      : "Owner consent granted";
  }
  return credential.ownerUserId === currentUserId
    ? "Not shared with organization"
    : "Owner consent required";
}

export function isProliferateManagedCreditsCredential(
  credential: AgentAuthCredential,
): boolean {
  return credential.credentialKind === "managed_gateway"
    && isProliferateManagedGatewayProviderKind(credential.redactedSummary.providerKind);
}

function isProliferateManagedGatewayProviderKind(providerKind: unknown): boolean {
  return providerKind === "proliferate_bedrock_pool"
    || providerKind === "proliferate_managed_anthropic"
    || providerKind === "proliferate_managed_openai"
    || providerKind === "proliferate_managed_gemini";
}

export function credentialSummaryDetails(credential: AgentAuthCredential): string {
  const summary = credential.redactedSummary;
  if (typeof summary.roleArn === "string" && typeof summary.region === "string") {
    return `${summary.roleArn} · ${summary.region}`;
  }
  if (typeof summary.baseUrl === "string") {
    return summary.baseUrl;
  }
  if (typeof summary.apiKey === "string") {
    return summary.apiKey;
  }
  if (typeof summary.authMode === "string") {
    return `Synced ${summary.authMode}`;
  }
  return "";
}

export function credentialSelectableReason(
  credential: AgentAuthCredential,
  _profileOwnerScope: string,
): string | null {
  if (credential.status !== "ready") {
    return `Credential is ${agentAuthCredentialStatusLabel(credential.status)}.`;
  }
  return null;
}

export function targetStateSummary(
  states: SandboxAgentAuthTargetState[],
  targetId: string,
): SandboxAgentAuthTargetState | null {
  return states.find((state) => state.targetId === targetId) ?? null;
}
