import { describe, expect, it } from "vitest";
import type { AgentAuthCredential } from "@proliferate/cloud-sdk";
import {
  credentialSelectableReason,
  isHostedCloudV1AgentAuthCredential,
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

describe("credentialSelectableReason", () => {
  it("requires an active share for personal synced credentials in organization profiles", () => {
    expect(
      credentialSelectableReason(credential({}), "organization"),
    ).toBe("Personal synced credentials need an active owner share before shared sandbox selection.");
  });

  it("allows shared personal synced credentials in organization profiles", () => {
    expect(
      credentialSelectableReason(
        credential({ activeCredentialShareId: "share-1" }),
        "organization",
      ),
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
