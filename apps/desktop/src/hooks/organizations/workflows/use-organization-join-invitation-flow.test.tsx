// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinInvitationFlow } from "./use-organization-join-invitation-flow";

const authActionMocks = vi.hoisted(() => ({
  signInWithGitHub: vi.fn<() => Promise<unknown>>(),
  signInWithSso: vi.fn<(_options?: unknown) => Promise<unknown>>(),
}));

vi.mock("@/hooks/auth/workflows/use-auth-actions", () => ({
  useAuthActions: () => ({
    signInWithGitHub: authActionMocks.signInWithGitHub,
    signInWithSso: authActionMocks.signInWithSso,
  }),
}));

function clearTestStorage() {
  window.localStorage?.clear();
}

function renderJoinInvitationFlow() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={["/settings?section=organization-members&joinOrganizationId=org-1"]}
      >
        {children}
      </MemoryRouter>
    );
  }

  return renderHook(() => useOrganizationJoinInvitationFlow(), { wrapper: Wrapper });
}

describe("useOrganizationJoinInvitationFlow", () => {
  beforeEach(() => {
    clearTestStorage();
    authActionMocks.signInWithGitHub.mockReset();
    authActionMocks.signInWithSso.mockReset();
    authActionMocks.signInWithGitHub.mockResolvedValue({});
    authActionMocks.signInWithSso.mockResolvedValue({});
    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    clearTestStorage();
    useAuthStore.setState({
      status: "bootstrapping",
      session: null,
      user: null,
      error: null,
    });
  });

  it("starts organization SSO for anonymous invite links", async () => {
    renderJoinInvitationFlow();

    await waitFor(() => {
      expect(authActionMocks.signInWithSso).toHaveBeenCalledWith({
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    authActionMocks.signInWithSso.mockRejectedValueOnce(
      new Error("SSO is not configured for this environment."),
    );

    renderJoinInvitationFlow();

    await waitFor(() => {
      expect(authActionMocks.signInWithGitHub).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fall back to GitHub for a configured SSO provider failure", async () => {
    authActionMocks.signInWithSso.mockRejectedValueOnce(new Error("SSO sign-in failed"));

    const { result } = renderJoinInvitationFlow();

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
      );
    });
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });
});
