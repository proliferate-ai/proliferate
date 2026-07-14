// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinAuthLaunch } from "./use-organization-join-auth-launch";

const authActionMocks = vi.hoisted(() => ({
  startLogin: vi.fn<(_options?: unknown) => Promise<void>>(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  return {
    useProductHost: () => {
      const status = useAuthStore((state) => state.status);
      return {
        auth: {
          state: status === "bootstrapping"
            ? { status: "loading" as const }
            : status === "authenticated"
              ? { status: "authenticated" as const, user: null, readiness: { status: "ready" as const } }
              : { status: "anonymous" as const, methods: [] },
          startLogin: authActionMocks.startLogin,
        },
      };
    },
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
    authActionMocks.startLogin.mockReset();
    authActionMocks.startLogin.mockResolvedValue(undefined);
    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: null,
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
      expect(authActionMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(authActionMocks.startLogin).toHaveBeenCalledTimes(1);
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    authActionMocks.startLogin
      .mockRejectedValueOnce(new Error("SSO is not configured for this environment."))
      .mockResolvedValueOnce(undefined);

    renderJoinAuthLaunch();

    await waitFor(() => {
      expect(authActionMocks.startLogin).toHaveBeenLastCalledWith({ kind: "github" });
    });
  });

  it("does not launch auth for already authenticated users", async () => {
    useAuthStore.setState({ status: "authenticated" });

    renderJoinAuthLaunch();

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(authActionMocks.startLogin).not.toHaveBeenCalled();
  });
});
