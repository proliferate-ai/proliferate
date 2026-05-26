import { describe, expect, it } from "vitest";
import {
  agentAuthGatewayCreatePayloadReady,
  agentAuthGatewayProviderOptionsForCapabilities,
  buildAgentAuthGatewayCredentialRequest,
  preferredAgentAuthGatewayProviderForAgent,
} from "./agent-auth-gateway-form";

const capabilities = {
  enabled: true,
  managedCreditsPersonalEnabled: true,
  managedCreditsOrganizationEnabled: true,
  defaultManagedBudgetUsd: "20",
  managedCreditAgentKinds: ["claude"],
  topology: "enterprise_shared",
  routeIsolation: "enterprise_team_project",
  liveProofStatus: "passed",
  byokEnabled: true,
  byokPersonalEnabled: true,
  byokOrganizationEnabled: true,
  byokOrganizationDisabledReason: null,
  byokProviders: {
    anthropicApiKey: true,
    openaiApiKey: true,
    geminiApiKey: false,
    bedrockAssumeRole: true,
    openaiCompatible: true,
  },
  opencodeGatewayEnabled: false,
};

describe("agentAuthGatewayProviderOptionsForCapabilities", () => {
  it("returns only enabled provider forms", () => {
    expect(
      agentAuthGatewayProviderOptionsForCapabilities({
        ...capabilities,
        byokProviders: {
          anthropicApiKey: false,
          openaiApiKey: true,
          geminiApiKey: false,
          bedrockAssumeRole: false,
          openaiCompatible: true,
        },
      }).map((option) => option.value),
    ).toEqual(["openai_api_key", "openai_compatible"]);
  });

  it("hides every provider when BYOK is disabled", () => {
    expect(
      agentAuthGatewayProviderOptionsForCapabilities({
        ...capabilities,
        byokEnabled: false,
      }),
    ).toEqual([]);
  });
});

describe("preferredAgentAuthGatewayProviderForAgent", () => {
  it("maps Claude to Anthropic first, Codex to OpenAI first, and Gemini to Gemini", () => {
    const options = agentAuthGatewayProviderOptionsForCapabilities(capabilities);

    expect(preferredAgentAuthGatewayProviderForAgent("claude", options, capabilities)).toBe(
      "anthropic_api_key",
    );
    expect(preferredAgentAuthGatewayProviderForAgent("codex", options, capabilities)).toBe(
      "openai_api_key",
    );
    expect(preferredAgentAuthGatewayProviderForAgent("gemini", options, capabilities)).toBeNull();
    const geminiCapabilities = {
      ...capabilities,
      byokProviders: { ...capabilities.byokProviders, geminiApiKey: true },
    };
    const geminiOptions = agentAuthGatewayProviderOptionsForCapabilities(geminiCapabilities);
    expect(preferredAgentAuthGatewayProviderForAgent(
      "gemini",
      geminiOptions,
      geminiCapabilities,
    )).toBe("gemini_api_key");
  });

  it("requires the OpenCode gateway capability", () => {
    const options = agentAuthGatewayProviderOptionsForCapabilities(capabilities);

    expect(preferredAgentAuthGatewayProviderForAgent("opencode", options, capabilities)).toBeNull();
    expect(
      preferredAgentAuthGatewayProviderForAgent(
        "opencode",
        options,
        { ...capabilities, opencodeGatewayEnabled: true },
      ),
    ).toBe("openai_api_key");
  });
});

describe("agentAuthGatewayCreatePayloadReady", () => {
  it("requires the fields for each provider kind", () => {
    expect(
      agentAuthGatewayCreatePayloadReady("openai_compatible", {
        apiKey: "sk-test",
        baseUrl: "",
        roleArn: "",
        region: "",
        externalId: "",
      }),
    ).toBe(false);
    expect(
      agentAuthGatewayCreatePayloadReady("bedrock_assume_role", {
        apiKey: "",
        baseUrl: "",
        roleArn: "arn:aws:iam::123456789012:role/proliferate-bedrock",
        region: "us-east-1",
        externalId: "proliferate-dev",
      }),
    ).toBe(true);
  });
});

describe("buildAgentAuthGatewayCredentialRequest", () => {
  it("builds org Bedrock credentials as Claude org BYOK", () => {
    expect(
      buildAgentAuthGatewayCredentialRequest({
        providerKind: "bedrock_assume_role",
        agentKind: "codex",
        ownerScope: "organization",
        organizationId: "org-1",
        displayName: " Production Bedrock ",
        values: {
          apiKey: "",
          baseUrl: "",
          roleArn: " arn:aws:iam::123456789012:role/proliferate-bedrock ",
          region: " us-east-1 ",
          externalId: " external-id ",
        },
      }),
    ).toMatchObject({
      ownerScope: "organization",
      organizationId: "org-1",
      agentKind: "claude",
      displayName: "Production Bedrock",
      policyKind: "org_byok",
      providerKind: "bedrock_assume_role",
      payload: {
        roleArn: "arn:aws:iam::123456789012:role/proliferate-bedrock",
        region: "us-east-1",
        externalId: "external-id",
      },
    });
  });

  it("builds Gemini API keys as Gemini BYOK", () => {
    expect(
      buildAgentAuthGatewayCredentialRequest({
        providerKind: "gemini_api_key",
        agentKind: "codex",
        ownerScope: "personal",
        organizationId: null,
        displayName: " Gemini ",
        values: {
          apiKey: " gemini-key ",
          baseUrl: "",
          roleArn: "",
          region: "",
          externalId: "",
        },
      }),
    ).toMatchObject({
      ownerScope: "personal",
      organizationId: null,
      agentKind: "gemini",
      displayName: "Gemini",
      policyKind: "personal_byok",
      providerKind: "gemini_api_key",
      payload: { apiKey: "gemini-key" },
    });
  });
});
