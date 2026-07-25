// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinAuthLaunch } from "./use-organization-join-auth-launch";

const authActionMocks = vi.hoisted(() => ({
  startLogin: vi.fn(),
}));

const hostMocks = vi.hoisted(() => ({
  storageValues: new Map<string, string>(),
  storage: {
    getItem: vi.fn(async (key: string) => hostMocks.storageValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      hostMocks.storageValues.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      hostMocks.storageValues.delete(key);
    }),
  },
  telemetry: {
    track: vi.fn(),
    captureException: vi.fn(),
  },
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
        storage: hostMocks.storage,
        telemetry: hostMocks.telemetry,
      };
    },
  };
});

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
    hostMocks.storageValues.clear();
    hostMocks.storage.getItem.mockClear();
    hostMocks.storage.setItem.mockClear();
    hostMocks.storage.removeItem.mockClear();
    hostMocks.telemetry.track.mockClear();
    hostMocks.telemetry.captureException.mockClear();
    authActionMocks.startLogin.mockReset();
    authActionMocks.startLogin.mockResolvedValue({
      provider: "github",
      source: "desktop_callback",
    });
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
    hostMocks.storageValues.clear();
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
      expect(hostMocks.storageValues.has("proliferate.organizationJoinTarget")).toBe(true);
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
