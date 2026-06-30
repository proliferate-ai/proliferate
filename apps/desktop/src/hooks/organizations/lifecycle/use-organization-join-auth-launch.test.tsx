// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinAuthLaunch } from "./use-organization-join-auth-launch";

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

function renderJoinAuthLaunch() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={["/settings?section=organization-members&joinOrganizationId=org-1"]}
      >
        {children}
      </MemoryRouter>
    );
  }

  return renderHook(() => useOrganizationJoinAuthLaunch(), { wrapper: Wrapper });
}

describe("useOrganizationJoinAuthLaunch", () => {
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

  it("starts organization SSO for anonymous invite routes before Settings mounts", async () => {
    renderJoinAuthLaunch();

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

    renderJoinAuthLaunch();

    await waitFor(() => {
      expect(authActionMocks.signInWithGitHub).toHaveBeenCalledTimes(1);
    });
  });

  it("does not launch auth for already authenticated users", async () => {
    useAuthStore.setState({ status: "authenticated" });

    renderJoinAuthLaunch();

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(authActionMocks.signInWithSso).not.toHaveBeenCalled();
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });
});
