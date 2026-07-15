// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinAuthLaunch } from "./use-organization-join-auth-launch";

const hostMocks = vi.hoisted(() => ({
  startLogin: vi.fn<(_request?: unknown) => Promise<{ provider: string; source: string }>>(),
}));

// The hook now launches auth through host.auth.startLogin; bridge the store so
// the anonymous/authenticated gating still steers via setState.
vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  const { authStoreBridgedHost } = await import("@/test/product-host-fixtures");
  return {
    useProductHost: () =>
      authStoreBridgedHost(
        useAuthStore((s) => s.status),
        useAuthStore((s) => s.user),
        { auth: { startLogin: hostMocks.startLogin } },
      ),
  };
});

function clearTestStorage() {
  window.localStorage?.clear();
}

function renderJoinAuthLaunch() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={["/settings?section=account&joinOrganizationId=org-1"]}
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
    hostMocks.startLogin.mockReset();
    hostMocks.startLogin.mockResolvedValue({ provider: "sso", source: "desktop_callback" });
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
      expect(hostMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
      });
    });
    expect(hostMocks.startLogin).not.toHaveBeenCalledWith({ kind: "github" });
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    hostMocks.startLogin.mockRejectedValueOnce(
      new Error("SSO is not configured for this environment."),
    );

    renderJoinAuthLaunch();

    await waitFor(() => {
      expect(hostMocks.startLogin).toHaveBeenCalledWith({ kind: "github" });
    });
  });

  it("does not launch auth for already authenticated users", async () => {
    useAuthStore.setState({ status: "authenticated" });

    renderJoinAuthLaunch();

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(hostMocks.startLogin).not.toHaveBeenCalled();
  });
});
