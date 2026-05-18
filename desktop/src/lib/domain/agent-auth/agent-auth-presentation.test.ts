import { describe, expect, it } from "vitest";
import type { AgentAuthCredential } from "@proliferate/cloud-sdk";
import { credentialSelectableReason } from "./agent-auth-presentation";

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
    legacyCloudCredentialId: null,
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
