// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationJoinInvitationFlow } from "./use-organization-join-invitation-flow";

const authActionMocks = vi.hoisted(() => ({
  startLogin: vi.fn<(_options?: unknown) => Promise<void>>(),
}));

const connectServerMocks = vi.hoisted(() => ({
  available: true,
  step: "closed" as string,
  openForUrl: vi.fn<(_url: string) => Promise<void>>(),
}));

const apiMocks = vi.hoisted(() => ({
  apiBaseUrl: "https://api.proliferate.com",
  isOfficialHostedApiBaseUrl: vi.fn<(_url: string) => boolean>(),
}));

const hostMocks = vi.hoisted(() => ({
  methods: ["github"] as Array<"password" | "github" | "sso">,
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
              : { status: "anonymous" as const, methods: hostMocks.methods },
          startLogin: authActionMocks.startLogin,
        },
        deployment: { apiBaseUrl: apiMocks.apiBaseUrl },
      };
    },
  };
});

vi.mock("@/hooks/auth/workflows/use-connect-server", () => ({
  useConnectServer: () => ({
    available: connectServerMocks.available,
    step: connectServerMocks.step,
    openForUrl: connectServerMocks.openForUrl,
  }),
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  isOfficialHostedApiBaseUrl: apiMocks.isOfficialHostedApiBaseUrl,
}));

function clearTestStorage() {
  window.localStorage?.clear();
}

function installTestStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function renderJoinInvitationFlow(initialEntry: string) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  }

  return renderHook(() => useOrganizationJoinInvitationFlow(), { wrapper: Wrapper });
}

const ORIGIN_LESS = "/settings?section=account&joinOrganizationId=org-1";
const PENDING_JOIN_STORAGE_KEY = "proliferate.organizationJoinTarget";

describe("useOrganizationJoinInvitationFlow", () => {
  beforeEach(() => {
    installTestStorage();
    clearTestStorage();
    authActionMocks.startLogin.mockReset();
    authActionMocks.startLogin.mockResolvedValue(undefined);
    connectServerMocks.available = true;
    connectServerMocks.step = "closed";
    connectServerMocks.openForUrl.mockReset();
    connectServerMocks.openForUrl.mockResolvedValue(undefined);
    // Default: current server is Cloud (no configured base URL); GitHub is
    // advertised, so the SSO/GitHub launch path is exercised.
    apiMocks.apiBaseUrl = "https://api.proliferate.com";
    apiMocks.isOfficialHostedApiBaseUrl.mockReset();
    apiMocks.isOfficialHostedApiBaseUrl.mockImplementation((url: string) => url.includes("proliferate.com"));
    hostMocks.methods = ["github"];
    useAuthStore.setState({ status: "anonymous", session: null, user: null, error: null, issue: null });
  });

  afterEach(() => {
    cleanup();
    clearTestStorage();
    useAuthStore.setState({ status: "bootstrapping", session: null, user: null, error: null });
  });

  it("starts organization SSO for anonymous invite links with no origin (unchanged behavior)", async () => {
    renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(authActionMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(authActionMocks.startLogin).toHaveBeenCalledTimes(1);
    expect(connectServerMocks.openForUrl).not.toHaveBeenCalled();
  });

  it("falls back to standard sign-in when the invited organization has no SSO", async () => {
    authActionMocks.startLogin
      .mockRejectedValueOnce(new Error("SSO is not configured for this environment."))
      .mockResolvedValueOnce(undefined);

    renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(authActionMocks.startLogin).toHaveBeenLastCalledWith({ kind: "github" });
    });
  });

  it("does not fall back to GitHub for a configured SSO provider failure", async () => {
    authActionMocks.startLogin.mockRejectedValueOnce(new Error("SSO sign-in failed"));

    const { result } = renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
      );
    });
    expect(authActionMocks.startLogin).toHaveBeenCalledTimes(1);
  });

  it("surfaces the trust-confirm dialog and starts NO auth when the invite origin differs from the current server", async () => {
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(connectServerMocks.openForUrl).toHaveBeenCalledWith("https://proliferate.corp.example");
    });
    expect(authActionMocks.startLogin).not.toHaveBeenCalled();
  });

  it("treats an origin matching the currently-configured server as a normal same-server join", async () => {
    apiMocks.apiBaseUrl = "https://proliferate.corp.example";
    const entry =
      "/settings?section=account&joinOrganizationId=org-1&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example";

    renderJoinInvitationFlow(entry);

    await waitFor(() => {
      expect(authActionMocks.startLogin).toHaveBeenCalledWith({
        kind: "sso",
        organizationId: "org-1",
        prompt: "select_account",
      });
    });
    expect(connectServerMocks.openForUrl).not.toHaveBeenCalled();
  });

  it("leaves the user on the sign-in surface (no auth launch) when the server is password-only", async () => {
    hostMocks.methods = ["password"];

    const { result } = renderJoinInvitationFlow(ORIGIN_LESS);

    await waitFor(() => {
      expect(result.current.statusMessage).toBe(
        "Sign in to accept this invitation. Use the sign-in form below.",
      );
    });
    expect(authActionMocks.startLogin).not.toHaveBeenCalled();
  });

  it("resumes one persisted join after authentication and clears it explicitly", async () => {
    const arrival = renderJoinInvitationFlow(ORIGIN_LESS);
    await waitFor(() => {
      expect(window.localStorage.getItem(PENDING_JOIN_STORAGE_KEY)).not.toBeNull();
      expect(authActionMocks.startLogin).toHaveBeenCalledTimes(1);
    });
    arrival.unmount();

    authActionMocks.startLogin.mockClear();
    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });
    const resumed = renderJoinInvitationFlow("/settings?section=account");

    await waitFor(() => {
      expect(resumed.result.current.joinOrganizationId).toBe("org-1");
      expect(resumed.result.current.statusMessage).toBe(
        "Review and accept the invitation below to join this organization.",
      );
    });
    expect(authActionMocks.startLogin).not.toHaveBeenCalled();

    act(() => resumed.result.current.clearJoinTarget());
    expect(resumed.result.current.joinOrganizationId).toBeNull();
    expect(window.localStorage.getItem(PENDING_JOIN_STORAGE_KEY)).toBeNull();
    resumed.unmount();

    const afterClear = renderJoinInvitationFlow("/settings?section=account");
    expect(afterClear.result.current.joinOrganizationId).toBeNull();
  });

  it("drops an expired persisted join instead of resuming it", () => {
    window.localStorage.setItem(
      PENDING_JOIN_STORAGE_KEY,
      JSON.stringify({
        organizationId: "org-expired",
        createdAt: Date.now() - (60 * 60 * 1000) - 1,
      }),
    );
    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    const { result } = renderJoinInvitationFlow("/settings?section=account");

    expect(result.current.joinOrganizationId).toBeNull();
    expect(window.localStorage.getItem(PENDING_JOIN_STORAGE_KEY)).toBeNull();
    expect(authActionMocks.startLogin).not.toHaveBeenCalled();
  });
});
