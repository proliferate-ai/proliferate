// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinInvitationFlow } from "./use-organization-join-invitation-flow";

const authActionMocks = vi.hoisted(() => ({
  signInWithGitHub: vi.fn<() => Promise<unknown>>(),
  signInWithSso: vi.fn<(_options?: unknown) => Promise<unknown>>(),
}));

const connectServerMocks = vi.hoisted(() => ({
  available: true,
  step: "closed" as string,
  openForUrl: vi.fn<(_url: string) => Promise<void>>(),
}));

const apiMocks = vi.hoisted(() => ({
  getRuntimeDesktopAppConfig: vi.fn<() => { apiBaseUrl: string | null }>(),
  isOfficialHostedApiBaseUrl: vi.fn<(_url: string) => boolean>(),
}));

const authMethodsMocks = vi.hoisted(() => ({
  getDesktopAuthMethods: vi.fn<() => Promise<{ passwordLogin: boolean; github: boolean }>>(),
}));

vi.mock("@/hooks/auth/workflows/use-auth-actions", () => ({
  useAuthActions: () => ({
    signInWithGitHub: authActionMocks.signInWithGitHub,
    signInWithSso: authActionMocks.signInWithSso,
  }),
}));

vi.mock("@/hooks/auth/workflows/use-connect-server", () => ({
  useConnectServer: () => ({
    available: connectServerMocks.available,
    step: connectServerMocks.step,
    openForUrl: connectServerMocks.openForUrl,
  }),
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  getRuntimeDesktopAppConfig: apiMocks.getRuntimeDesktopAppConfig,
  isOfficialHostedApiBaseUrl: apiMocks.isOfficialHostedApiBaseUrl,
}));

vi.mock("@/lib/integrations/auth/proliferate-auth-password", () => ({
  getDesktopAuthMethods: authMethodsMocks.getDesktopAuthMethods,
}));

function clearTestStorage() {
  window.localStorage?.clear();
}

function renderJoinInvitationFlow(initialEntry: string) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  }

  return renderHook(() => useOrganizationJoinInvitationFlow(), { wrapper: Wrapper });
}

const ORIGIN_LESS = "/settings?section=account&joinOrganizationId=org-1";

describe("useOrganizationJoinInvitationFlow", () => {
  beforeEach(() => {
    clearTestStorage();
    authActionMocks.signInWithGitHub.mockReset();
    authActionMocks.signInWithSso.mockReset();
    authActionMocks.signInWithGitHub.mockResolvedValue({});
    authActionMocks.signInWithSso.mockResolvedValue({});
    connectServerMocks.available = true;
    connectServerMocks.step = "closed";
    connectServerMocks.openForUrl.mockReset();
    connectServerMocks.openForUrl.mockResolvedValue(undefined);
    // Default: current server is Cloud (no configured base URL); GitHub is
    // advertised, so the SSO/GitHub launch path is exercised.
    apiMocks.getRuntimeDesktopAppConfig.mockReset();
    apiMocks.getRuntimeDesktopAppConfig.mockReturnValue({ apiBaseUrl: null });
    apiMocks.isOfficialHostedApiBaseUrl.mockReset();
    apiMocks.isOfficialHostedApiBaseUrl.mockImplementation((url: string) => url.includes("proliferate.com"));
    authMethodsMocks.getDesktopAuthMethods.mockReset();
    authMethodsMocks.getDesktopAuthMethods.mockResolvedValue({ passwordLogin: false, github: true });
    useAuthStore.setState({ status: "anonymous", session: null, user: null, error: null });
  });

  afterEach(() => {
    cleanup();
    clearTestStorage();
    useAuthStore.setState({ status: "bootstrapping", session: null, user: null, error: null });
  });

  it("starts organization SSO for anonymous invite links with no origin (unchanged behavior)", async () => {
    renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(authActionMocks.signInWithSso).toHaveBeenCalledWith({
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
    expect(connectServerMocks.openForUrl).not.toHaveBeenCalled();
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    authActionMocks.signInWithSso.mockRejectedValueOnce(
      new Error("SSO is not configured for this environment."),
    );

    renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(authActionMocks.signInWithGitHub).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fall back to GitHub for a configured SSO provider failure", async () => {
    authActionMocks.signInWithSso.mockRejectedValueOnce(new Error("SSO sign-in failed"));

    const { result } = renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
      );
    });
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });

  it("surfaces the trust-confirm dialog and starts NO auth when the invite origin differs from the current server", async () => {
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(connectServerMocks.openForUrl).toHaveBeenCalledWith("https://proliferate.corp.example");
    });
    expect(authActionMocks.signInWithSso).not.toHaveBeenCalled();
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });

  it("treats an origin matching the currently-configured server as a normal same-server join", async () => {
    apiMocks.getRuntimeDesktopAppConfig.mockReturnValue({
      apiBaseUrl: "https://proliferate.corp.example",
    });
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(authActionMocks.signInWithSso).toHaveBeenCalledWith({
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(connectServerMocks.openForUrl).not.toHaveBeenCalled();
  });

  it("leaves the user on the sign-in surface (no auth launch) when the server is password-only", async () => {
    authMethodsMocks.getDesktopAuthMethods.mockResolvedValue({ passwordLogin: true, github: false });

    const { result } = renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in to accept this invitation. Use the sign-in form below.",
      );
    });
    expect(authActionMocks.signInWithSso).not.toHaveBeenCalled();
    expect(authActionMocks.signInWithGitHub).not.toHaveBeenCalled();
  });
});
