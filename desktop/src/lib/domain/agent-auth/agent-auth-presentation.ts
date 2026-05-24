import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
  SandboxAgentAuthTargetState,
} from "@proliferate/cloud-sdk";

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

export function isAgentAuthAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export const AGENT_AUTH_AGENT_ORDER: AgentAuthAgentKind[] = [
  "claude",
  "codex",
  "opencode",
  "gemini",
];

export function agentAuthAgentLabel(agentKind: string): string {
  if (agentKind === "claude") {
    return "Claude";
  }
  if (agentKind === "codex") {
    return "Codex";
  }
  if (agentKind === "opencode") {
    return "OpenCode";
  }
  if (agentKind === "gemini") {
    return "Gemini";
  }
  return agentKind;
}

export function agentAuthHarnessDescription(agentKind: string): string {
  if (agentKind === "claude") {
    return "Anthropic models - Claude Code harness";
  }
  if (agentKind === "codex") {
    return "OpenAI models - Codex CLI harness";
  }
  if (agentKind === "opencode") {
    return "Anthropic or OpenAI models - OpenCode harness";
  }
  if (agentKind === "gemini") {
    return "Google models - Gemini CLI harness";
  }
  return "Agent harness";
}

export function agentAuthCredentialKindLabel(credential: AgentAuthCredential): string {
  if (credential.credentialKind === "managed_gateway") {
    const providerKind = credential.redactedSummary.providerKind;
    if (providerKind === "proliferate_bedrock_pool") {
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
    if (providerKind === "openai_compatible") {
      return "OpenAI-compatible provider";
    }
    return "Gateway credential";
  }
  if (credential.credentialKind === "synced_path") {
    return `Synced ${agentAuthAgentLabel(credential.agentKind)} auth`;
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

export function agentAuthManagedCreditsCapabilityLabel(
  capabilities: AgentGatewayCapabilities | null | undefined,
  ownerScope: "personal" | "organization",
): string {
  if (!capabilities) {
    return "Checking managed credit capability.";
  }
  if (!capabilities.enabled) {
    return "Gateway is disabled for this deployment.";
  }
  if (ownerScope === "organization") {
    return capabilities.managedCreditsOrganizationEnabled
      ? "Managed credits can be provisioned for shared cloud sandboxes."
      : "Managed credits are not enabled for shared cloud sandboxes.";
  }
  return capabilities.managedCreditsPersonalEnabled
    ? "Managed credits can be used by personal cloud sandboxes."
    : "Managed credits are not enabled for personal cloud sandboxes.";
}

export function agentAuthByokCapabilityLabel(
  capabilities: AgentGatewayCapabilities | null | undefined,
): string {
  if (!capabilities) {
    return "Checking BYOK capability.";
  }
  if (!capabilities.enabled || !capabilities.byokEnabled) {
    return "BYOK provider forms are not enabled for this deployment.";
  }
  return "BYOK provider forms are enabled for this deployment.";
}

export function agentAuthCanCreateGatewayCredentialForAgent(
  agentKind: AgentAuthAgentKind,
  capabilities: AgentGatewayCapabilities | null | undefined,
): boolean {
  if (!capabilities?.enabled || !capabilities.byokEnabled) {
    return false;
  }
  if (agentKind === "claude") {
    return capabilities.byokProviders.anthropicApiKey
      || capabilities.byokProviders.bedrockAssumeRole;
  }
  if (agentKind === "codex") {
    return capabilities.byokProviders.openaiApiKey
      || capabilities.byokProviders.openaiCompatible;
  }
  if (agentKind === "opencode") {
    return capabilities.opencodeGatewayEnabled === true
      && (
        capabilities.byokProviders.openaiApiKey
        || capabilities.byokProviders.openaiCompatible
      );
  }
  return false;
}

export function gatewayByokCredentialEnabled(
  credential: AgentAuthCredential,
  capabilities: AgentGatewayCapabilities | null | undefined,
): boolean {
  const providerKind = credential.redactedSummary.providerKind;
  if (!capabilities?.enabled || !capabilities.byokEnabled) {
    return false;
  }
  if (providerKind === "anthropic_api_key") {
    return capabilities.byokProviders.anthropicApiKey;
  }
  if (providerKind === "openai_api_key") {
    return capabilities.byokProviders.openaiApiKey;
  }
  if (providerKind === "bedrock_assume_role") {
    return capabilities.byokProviders.bedrockAssumeRole;
  }
  if (providerKind === "openai_compatible") {
    return capabilities.byokProviders.openaiCompatible;
  }
  return false;
}

export function isProliferateManagedCreditsCredential(
  credential: AgentAuthCredential,
): boolean {
  return credential.credentialKind === "managed_gateway"
    && credential.redactedSummary.providerKind === "proliferate_bedrock_pool";
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

export function selectionByAgentKind(
  selections: SandboxAgentAuthSelection[],
): Map<string, SandboxAgentAuthSelection> {
  return new Map(selections.map((selection) => [selection.agentKind, selection]));
}

export function targetStateSummary(
  states: SandboxAgentAuthTargetState[],
  targetId: string,
): SandboxAgentAuthTargetState | null {
  return states.find((state) => state.targetId === targetId) ?? null;
}
