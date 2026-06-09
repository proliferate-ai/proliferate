import type {
  AgentGatewayCapabilities,
  CreateGatewayCredentialRequest,
} from "@proliferate/cloud-sdk";

export type AgentAuthGatewayProviderChoice =
  | "anthropic_api_key"
  | "openai_api_key"
  | "gemini_api_key"
  | "bedrock_assume_role"
  | "openai_compatible";

export type AgentAuthGatewayProviderOption = {
  value: AgentAuthGatewayProviderChoice;
  label: string;
};

export interface AgentAuthGatewayFormValues {
  apiKey: string;
  baseUrl: string;
  roleArn: string;
  region: string;
  externalId: string;
}

export const AGENT_AUTH_GATEWAY_PROVIDER_OPTIONS: AgentAuthGatewayProviderOption[] = [
  { value: "anthropic_api_key", label: "Anthropic API key" },
  { value: "openai_api_key", label: "OpenAI API key" },
  { value: "gemini_api_key", label: "Gemini API key" },
  { value: "bedrock_assume_role", label: "AWS Bedrock role" },
  { value: "openai_compatible", label: "OpenAI-compatible provider" },
];

export function agentAuthGatewayProviderOptionsForCapabilities(
  capabilities: AgentGatewayCapabilities | null,
): AgentAuthGatewayProviderOption[] {
  if (
    !capabilities?.enabled
    || !capabilities.byokEnabled
    || (!capabilities.byokPersonalEnabled && !capabilities.byokOrganizationEnabled)
  ) {
    return [];
  }
  return AGENT_AUTH_GATEWAY_PROVIDER_OPTIONS.filter((option) => {
    if (option.value === "anthropic_api_key") {
      return capabilities.byokProviders.anthropicApiKey;
    }
    if (option.value === "openai_api_key") {
      return capabilities.byokProviders.openaiApiKey;
    }
    if (option.value === "gemini_api_key") {
      return capabilities.byokProviders.geminiApiKey;
    }
    if (option.value === "bedrock_assume_role") {
      return capabilities.byokProviders.bedrockAssumeRole;
    }
    if (option.value === "openai_compatible") {
      return capabilities.byokProviders.openaiCompatible;
    }
    return false;
  });
}

export function agentAuthGatewayCreatePayloadReady(
  providerKind: AgentAuthGatewayProviderChoice,
  values: AgentAuthGatewayFormValues,
) {
  if (
    providerKind === "anthropic_api_key"
    || providerKind === "openai_api_key"
    || providerKind === "gemini_api_key"
  ) {
    return values.apiKey.trim().length > 0;
  }
  if (providerKind === "openai_compatible") {
    return values.apiKey.trim().length > 0 && values.baseUrl.trim().length > 0;
  }
  return values.roleArn.trim().length > 0
    && values.region.trim().length > 0
    && values.externalId.trim().length > 0;
}

export function buildAgentAuthGatewayCredentialRequest(input: {
  providerKind: AgentAuthGatewayProviderChoice;
  ownerScope: "personal" | "organization";
  organizationId: string | null;
  displayName: string;
  values: AgentAuthGatewayFormValues;
}): CreateGatewayCredentialRequest {
  const credentialProviderId = input.providerKind === "gemini_api_key"
    ? "gemini"
    : input.providerKind === "openai_api_key" || input.providerKind === "openai_compatible"
      ? "openai"
      : "anthropic";
  const payload: Record<string, string> = input.providerKind === "bedrock_assume_role"
    ? {
        roleArn: input.values.roleArn.trim(),
        region: input.values.region.trim(),
        externalId: input.values.externalId.trim(),
      }
    : input.providerKind === "openai_compatible"
      ? {
          baseUrl: input.values.baseUrl.trim(),
          apiKey: input.values.apiKey.trim(),
        }
      : { apiKey: input.values.apiKey.trim() };

  return {
    ownerScope: input.ownerScope,
    organizationId: input.ownerScope === "organization" ? input.organizationId : null,
    credentialProviderId,
    displayName: input.displayName.trim(),
    policyKind: input.ownerScope === "organization" ? "org_byok" : "personal_byok",
    providerKind: input.providerKind,
    payload,
  };
}
