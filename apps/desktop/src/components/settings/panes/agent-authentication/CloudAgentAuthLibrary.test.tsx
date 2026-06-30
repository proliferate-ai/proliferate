// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAgentAuthLibrary } from "./CloudAgentAuthLibrary";

const libraryMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAgentAuthLibraryActions: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => libraryMock.navigate,
}));

vi.mock("@/hooks/settings/workflows/use-agent-auth-library-actions", () => ({
  useAgentAuthLibraryActions: libraryMock.useAgentAuthLibraryActions,
}));

vi.mock("@/components/settings/panes/agent-authentication/AuthenticationMethodsSection", () => ({
  AuthenticationMethodsSection: () => <div data-testid="authentication-methods" />,
}));

describe("CloudAgentAuthLibrary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not block personal cloud choices while profile selections are loading", () => {
    libraryMock.useAgentAuthLibraryActions.mockReturnValue(makeLibraryState({
      personalSelectionsLoading: true,
    }));

    render(<CloudAgentAuthLibrary />);

    expect(screen.queryByRole("button", { name: "Loading..." })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /Choose credential/i }).length)
      .toBeGreaterThan(0);
  });
});

function makeLibraryState(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {
      enabled: true,
      managedCreditsPersonalEnabled: true,
      managedCreditAgentKinds: ["claude", "codex"],
      managedCreditsOrganizationEnabled: false,
      byokEnabled: false,
      agentAuthSlots: [{
        agentKind: "claude",
        authSlotId: "anthropic",
        credentialProviderIds: ["anthropic"],
        label: "Claude Anthropic",
        localProvider: "claude",
        primary: true,
        shortLabel: "Anthropic",
      }],
    },
    currentUserId: "user-1",
    ensuringFreeCredits: false,
    feedback: null,
    focusedAgentKind: null,
    handleEnsureFreeCredits: vi.fn(),
    handleEnsurePersonalProfile: vi.fn(),
    handleRescan: vi.fn(),
    handleRevokeCredential: vi.fn(),
    handleSelectPersonalDefault: vi.fn(),
    handleSyncLocalCredential: vi.fn(),
    localSourceError: null,
    localSourcesByProvider: new Map(),
    personalCredentialsByProvider: new Map([
      ["anthropic", [
        {
          id: "cred-claude",
          credentialProviderId: "anthropic",
          credentialKind: "managed_gateway",
          displayName: "Proliferate Default Free credits",
          ownerScope: "personal",
          ownerUserId: "user-1",
          organizationId: null,
          activeCredentialShareId: null,
          status: "ready",
          redactedSummary: { providerKind: "anthropic_api_key", agentKind: "claude" },
        },
      ]],
    ]),
    personalCredentialsError: null,
    personalCredentialsLoading: false,
    personalProfile: null,
    personalSelections: [],
    personalSelectionsLoading: false,
    rescanning: false,
    revokingCredentialId: null,
    selectingPersonalDefault: false,
    syncingLocalProvider: null,
    ...overrides,
  };
}
