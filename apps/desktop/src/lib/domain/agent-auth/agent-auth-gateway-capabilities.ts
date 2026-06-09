import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";

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
  ownerScope?: "personal" | "organization",
): string {
  if (!capabilities) {
    return "Checking BYOK capability.";
  }
  if (!capabilities.enabled || !capabilities.byokEnabled) {
    return "BYOK provider forms are not enabled for this deployment.";
  }
  if (ownerScope === "personal" && !capabilities.byokPersonalEnabled) {
    return "Personal BYOK is unavailable for this deployment.";
  }
  if (ownerScope === "organization" && !capabilities.byokOrganizationEnabled) {
    return "Organization BYOK is unavailable until gateway route isolation is verified.";
  }
  if (!capabilities.byokPersonalEnabled && !capabilities.byokOrganizationEnabled) {
    return "BYOK is configured but no cloud owner scope is enabled for provider credentials.";
  }
  if (!capabilities.byokOrganizationEnabled && capabilities.byokOrganizationDisabledReason) {
    return "Organization BYOK is unavailable until gateway route isolation is verified.";
  }
  return "BYOK provider forms are enabled for this deployment.";
}

export function gatewayByokCredentialEnabled(
  credential: AgentAuthCredential,
  capabilities: AgentGatewayCapabilities | null | undefined,
): boolean {
  const providerKind = credential.redactedSummary.providerKind;
  if (!capabilities?.enabled || !capabilities.byokEnabled) {
    return false;
  }
  if (credential.ownerScope === "organization" && !capabilities.byokOrganizationEnabled) {
    return false;
  }
  if (credential.ownerScope === "personal" && !capabilities.byokPersonalEnabled) {
    return false;
  }
  if (providerKind === "anthropic_api_key") {
    return capabilities.byokProviders.anthropicApiKey;
  }
  if (providerKind === "openai_api_key") {
    return capabilities.byokProviders.openaiApiKey;
  }
  if (providerKind === "gemini_api_key") {
    return capabilities.byokProviders.geminiApiKey;
  }
  if (providerKind === "bedrock_assume_role") {
    return capabilities.byokProviders.bedrockAssumeRole;
  }
  if (providerKind === "openai_compatible") {
    return capabilities.byokProviders.openaiCompatible;
  }
  return false;
}
