// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "#product/test/auth-store-double";
import { useOrganizationJoinInvitationFlow } from "./use-organization-join-invitation-flow";

const hostMocks = vi.hoisted(() => ({
  startLogin: vi.fn<(_request?: unknown) => Promise<{ provider: string; source: string }>>(),
}));

const connectServerMocks = vi.hoisted(() => ({
  available: true,
  step: "closed" as string,
  openForUrl: vi.fn<(_url: string) => Promise<void>>(),
}));

const apiMocks = vi.hoisted(() => ({
  isOfficialHostedApiBaseUrl: vi.fn<(_url: string) => boolean>(),
}));

// The moved hook now sources the current server's base URL from
// host.deployment.apiBaseUrl (was getRuntimeDesktopAppConfig pre-move); drive it
// through the bridged test host.
const deploymentMocks = vi.hoisted(() => ({
  // "" == Cloud / no configured server (falsy, as the old getRuntimeDesktopAppConfig
  // null did); host.deployment.apiBaseUrl is a non-null string.
  apiBaseUrl: "" as string,
}));

const authMethodsMocks = vi.hoisted(() => ({
  getDesktopAuthMethods: vi.fn<() => Promise<{ passwordLogin: boolean; github: boolean }>>(),
}));

// The flow launches auth through host.auth.startLogin; bridge the store so the
// anonymous/authenticated gating still steers via setState.
vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("#product/test/auth-store-double");
  const { authStoreBridgedHost } = await import("#product/test/product-host-fixtures");
  return {
    useProductHost: () =>
      authStoreBridgedHost(
        useAuthStore((s) => s.status),
        useAuthStore((s) => s.user),
        {
          auth: { startLogin: hostMocks.startLogin },
          deployment: { apiBaseUrl: deploymentMocks.apiBaseUrl },
        },
      ),
  };
});

vi.mock("#product/hooks/auth/workflows/use-connect-server", () => ({
  useConnectServer: () => ({
    available: connectServerMocks.available,
    step: connectServerMocks.step,
    openForUrl: connectServerMocks.openForUrl,
  }),
}));

vi.mock("#product/lib/infra/proliferate-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/infra/proliferate-api")
  >()),
  isOfficialHostedApiBaseUrl: apiMocks.isOfficialHostedApiBaseUrl,
}));

vi.mock("#product/lib/access/cloud/auth-probes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/access/cloud/auth-probes")
  >()),
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
    hostMocks.startLogin.mockReset();
    hostMocks.startLogin.mockResolvedValue({ provider: "sso", source: "desktop_callback" });
    connectServerMocks.available = true;
    connectServerMocks.step = "closed";
    connectServerMocks.openForUrl.mockReset();
    connectServerMocks.openForUrl.mockResolvedValue(undefined);
    // Default: current server is Cloud (no configured base URL); GitHub is
    // advertised, so the SSO/GitHub launch path is exercised.
    deploymentMocks.apiBaseUrl = "";
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
      expect(hostMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
      });
    });
    expect(hostMocks.startLogin).not.toHaveBeenCalledWith({ kind: "github" });
    expect(connectServerMocks.openForUrl).not.toHaveBeenCalled();
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    hostMocks.startLogin.mockRejectedValueOnce(
      new Error("SSO is not configured for this environment."),
    );

    renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(hostMocks.startLogin).toHaveBeenCalledWith({ kind: "github" });
    });
  });

  it("does not fall back to GitHub for a configured SSO provider failure", async () => {
    hostMocks.startLogin.mockRejectedValueOnce(new Error("SSO sign-in failed"));

    const { result } = renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
      );
    });
    expect(hostMocks.startLogin).not.toHaveBeenCalledWith({ kind: "github" });
  });

  it("surfaces the trust-confirm dialog and starts NO auth when the invite origin differs from the current server", async () => {
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(connectServerMocks.openForUrl).toHaveBeenCalledWith("https://proliferate.corp.example");
    });
    expect(hostMocks.startLogin).not.toHaveBeenCalled();
  });

  it("treats an origin matching the currently-configured server as a normal same-server join", async () => {
    deploymentMocks.apiBaseUrl = "https://proliferate.corp.example";
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(hostMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
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
    expect(hostMocks.startLogin).not.toHaveBeenCalled();
  });
});
