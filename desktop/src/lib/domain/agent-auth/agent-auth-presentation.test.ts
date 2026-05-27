import { describe, expect, it } from "vitest";
import type { AgentAuthCredential, AgentGatewayCapabilities } from "@proliferate/cloud-sdk";
import {
  agentAuthCanCreateGatewayCredentialForAgent,
  agentAuthCredentialAvailability,
  agentAuthCredentialDisplayLabel,
  agentAuthCredentialSection,
  agentAuthCredentialShareLabel,
  agentAuthManagedCreditsCapabilityLabel,
  credentialSelectableReason,
  isHostedCloudV1AgentAuthCredential,
  isAgentAuthAdminRole,
  isProliferateManagedCreditsCredential,
} from "./agent-auth-presentation";

function credential(
  overrides: Partial<AgentAuthCredential>,
): AgentAuthCredential {
  return {
    id: "credential-1",
    ownerScope: "personal",
    ownerUserId: "user-1",
    organizationId: null,
    createdByUserId: "user-1",
    agentKind: "claude",
    credentialKind: "synced_path",
    displayName: "Synced Claude auth",
    redactedSummary: {},
    status: "ready",
    revision: 1,
    activeCredentialShareId: null,
    revokedAt: null,
    ...overrides,
  };
}

function capabilities(
  overrides: Partial<AgentGatewayCapabilities>,
): AgentGatewayCapabilities {
  return {
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
      anthropicApiKey: false,
      openaiApiKey: false,
      geminiApiKey: false,
      bedrockAssumeRole: false,
      openaiCompatible: false,
    },
    opencodeGatewayEnabled: false,
    ...overrides,
  };
}

describe("credentialSelectableReason", () => {
  it("allows personal synced credentials in organization profiles without an owner share", () => {
    expect(
      credentialSelectableReason(credential({}), "organization"),
    ).toBeNull();
  });
});

describe("isHostedCloudV1AgentAuthCredential", () => {
  it("shows synced native credentials", () => {
    expect(isHostedCloudV1AgentAuthCredential(credential({}))).toBe(true);
  });

  it("shows Proliferate managed credits", () => {
    expect(
      isHostedCloudV1AgentAuthCredential(
        credential({
          credentialKind: "managed_gateway",
          redactedSummary: { providerKind: "proliferate_bedrock_pool" },
        }),
      ),
    ).toBe(true);
  });

  it("hides BYOK gateway credentials", () => {
    expect(
      isHostedCloudV1AgentAuthCredential(
        credential({
          credentialKind: "managed_gateway",
          redactedSummary: { providerKind: "anthropic_api_key" },
        }),
      ),
    ).toBe(false);
  });
});

describe("isProliferateManagedCreditsCredential", () => {
  it("matches only the Proliferate managed gateway provider", () => {
    expect(
      isProliferateManagedCreditsCredential(
        credential({
          credentialKind: "managed_gateway",
          redactedSummary: { providerKind: "proliferate_bedrock_pool" },
        }),
      ),
    ).toBe(true);
    expect(isProliferateManagedCreditsCredential(credential({}))).toBe(false);
  });
});

describe("agentAuthCredentialDisplayLabel", () => {
  it("uses a product label for personal free-credit credentials", () => {
    expect(
      agentAuthCredentialDisplayLabel(
        credential({
          credentialKind: "managed_gateway",
          displayName: "Proliferate free credits",
          redactedSummary: { providerKind: "proliferate_bedrock_pool" },
        }),
      ),
    ).toBe("Proliferate Default Free credits");
  });

  it("preserves organization managed credit labels", () => {
    expect(
      agentAuthCredentialDisplayLabel(
        credential({
          ownerScope: "organization",
          ownerUserId: null,
          organizationId: "org-1",
          credentialKind: "managed_gateway",
          displayName: "Proliferate managed credits",
          redactedSummary: { providerKind: "proliferate_bedrock_pool" },
        }),
      ),
    ).toBe("Proliferate managed credits");
  });
});

describe("agentAuthCredentialAvailability", () => {
  it("marks BYOK credentials unavailable when hosted BYOK is disabled", () => {
    const availability = agentAuthCredentialAvailability(
      credential({
        credentialKind: "managed_gateway",
        redactedSummary: { providerKind: "anthropic_api_key" },
      }),
      capabilities({
        byokEnabled: false,
        byokProviders: {
          anthropicApiKey: false,
          openaiApiKey: false,
          geminiApiKey: false,
          bedrockAssumeRole: false,
          openaiCompatible: false,
        },
      }),
    );

    expect(availability.status).toBe("unavailable");
    expect(availability.label).toBe("Unavailable in hosted cloud");
  });

  it("marks provider credentials available when the matching BYOK capability is enabled", () => {
    const availability = agentAuthCredentialAvailability(
      credential({
        credentialKind: "managed_gateway",
        redactedSummary: { providerKind: "openai_api_key" },
      }),
      capabilities({
        byokProviders: {
          anthropicApiKey: false,
          openaiApiKey: true,
          geminiApiKey: false,
          bedrockAssumeRole: false,
          openaiCompatible: false,
        },
      }),
    );

    expect(availability.status).toBe("available");
  });
});

describe("agentAuthCredentialSection", () => {
  it("separates managed, organization, personal, and shared personal credentials", () => {
    expect(
      agentAuthCredentialSection(
        credential({
          credentialKind: "managed_gateway",
          redactedSummary: { providerKind: "proliferate_bedrock_pool" },
        }),
      ),
    ).toBe("managed_credits");
    expect(agentAuthCredentialSection(credential({ ownerScope: "organization" }))).toBe(
      "organization_credentials",
    );
    expect(agentAuthCredentialSection(credential({}))).toBe("personal_credentials");
    expect(agentAuthCredentialSection(credential({ activeCredentialShareId: "share-1" }))).toBe(
      "shared_personal_credentials",
    );
  });
});

describe("agentAuthCredentialShareLabel", () => {
  it("surfaces owner-consent state for personal synced credentials", () => {
    expect(agentAuthCredentialShareLabel(credential({}), "user-1")).toBe(
      "Not shared with organization",
    );
    expect(
      agentAuthCredentialShareLabel(
        credential({ ownerUserId: "user-2", activeCredentialShareId: "share-1" }),
        "user-1",
      ),
    ).toBe("Owner consent granted");
  });
});

describe("agentAuthManagedCreditsCapabilityLabel", () => {
  it("describes disabled organization managed credits", () => {
    expect(
      agentAuthManagedCreditsCapabilityLabel(
        capabilities({
          managedCreditsOrganizationEnabled: false,
          byokEnabled: false,
        }),
        "organization",
      ),
    ).toBe("Managed credits are not enabled for shared cloud sandboxes.");
  });
});

describe("agentAuthCanCreateGatewayCredentialForAgent", () => {
  it("matches gateway provider forms to the harness they can configure", () => {
    const inputCapabilities = capabilities({
      byokProviders: {
        anthropicApiKey: true,
        openaiApiKey: true,
        geminiApiKey: true,
        bedrockAssumeRole: false,
        openaiCompatible: false,
      },
    });

    expect(agentAuthCanCreateGatewayCredentialForAgent("claude", inputCapabilities)).toBe(true);
    expect(agentAuthCanCreateGatewayCredentialForAgent("codex", inputCapabilities)).toBe(true);
    expect(agentAuthCanCreateGatewayCredentialForAgent("opencode", inputCapabilities)).toBe(false);
    expect(agentAuthCanCreateGatewayCredentialForAgent("gemini", inputCapabilities)).toBe(true);
  });
});

describe("isAgentAuthAdminRole", () => {
  it("allows owner and admin roles only", () => {
    expect(isAgentAuthAdminRole("owner")).toBe(true);
    expect(isAgentAuthAdminRole("admin")).toBe(true);
    expect(isAgentAuthAdminRole("member")).toBe(false);
    expect(isAgentAuthAdminRole(null)).toBe(false);
  });
});
