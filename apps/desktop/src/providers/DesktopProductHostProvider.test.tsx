// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useAuthStore } from "@/stores/auth/auth-store";
import { DesktopProductHostProvider } from "./DesktopProductHostProvider";

const h = vi.hoisted(() => ({
  restoreSession: vi.fn(async () => {}),
  actions: {
    signInWithGitHub: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithSso: vi.fn(),
    signOut: vi.fn(),
    cancelAuthFlow: vi.fn(),
    linkGoogle: vi.fn(),
  },
  deps: {},
  cloudEnabled: true,
  authMethods: { passwordLogin: true, github: true } as unknown,
  github: { enabled: true, clientId: null } as unknown,
  sso: { enabled: true } as unknown,
  getProliferateClient: vi.fn(),
  desktopBridge: { nativeUi: { setRunningAgentCount: vi.fn() } },
}));

// Auth/capability hooks are mocked so the test drives their outputs directly;
// auth *status/identity* is driven through the real store below.
vi.mock("@/hooks/auth/lifecycle/use-auth-bootstrap", () => ({
  useAuthBootstrap: () => h.restoreSession,
}));
vi.mock("@/hooks/auth/workflows/use-auth-actions", () => ({
  useAuthActions: () => h.actions,
}));
vi.mock("@/hooks/auth/workflows/use-auth-orchestration-effects", () => ({
  useAuthOrchestrationEffects: () => h.deps,
}));
vi.mock("@/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ cloudEnabled: h.cloudEnabled }),
}));
vi.mock("@/hooks/access/cloud/auth/use-auth-methods", () => ({
  useDesktopAuthMethods: () => ({ data: h.authMethods }),
}));
vi.mock("@/hooks/access/cloud/auth/use-github-auth-availability", () => ({
  useGitHubDesktopAuthAvailability: () => ({ data: h.github }),
}));
vi.mock("@/hooks/access/cloud/auth/use-sso-discovery", () => ({
  useSsoDiscovery: () => ({ data: h.sso }),
}));
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isProductAuthRequired: () => true,
}));
// The provider must never construct a second Cloud client.
vi.mock("@/lib/access/cloud/client", () => ({
  getProliferateClient: h.getProliferateClient,
}));
// Stable bridge double, avoids loading the real Tauri bridge chain.
vi.mock("@/lib/access/tauri/desktop-bridge", () => ({
  desktopBridge: h.desktopBridge,
}));
// Leaf deps of desktop-product-host: keep host construction real while
// avoiding any Tauri/telemetry side effects during import/render.
vi.mock("@/lib/infra/proliferate-api", () => ({
  getProliferateApiBaseUrl: () => "https://api.example.test",
}));
vi.mock("@/lib/access/tauri/config", () => ({ setDesktopAppConfig: vi.fn() }));
vi.mock("@/lib/access/tauri/updater", () => ({ relaunch: vi.fn() }));
vi.mock("@/lib/access/tauri/shell", () => ({
  copyText: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("@/lib/access/tauri/deep-link", () => ({
  subscribeDeepLinkUrls: vi.fn(() => () => {}),
}));
vi.mock("@/lib/integrations/auth/orchestration-callback", () => ({
  handleDesktopCallbackUrl: vi.fn(),
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", () => ({
  DESKTOP_AUTH_REDIRECT_URI: "proliferate://auth/callback",
}));
vi.mock("@/lib/integrations/auth/proliferate-sso-auth", () => ({
  discoverDesktopSso: vi.fn(),
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: vi.fn(),
  captureTelemetryException: vi.fn(),
  setTelemetryUser: vi.fn(),
  clearTelemetryUser: vi.fn(),
  setTelemetryTag: vi.fn(),
  getSupportReportReleaseId: vi.fn(() => "desktop@test"),
  getSupportReportTelemetryRefs: vi.fn(() => undefined),
}));

let cloudClient: unknown;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <DesktopProductHostProvider cloudClient={cloudClient as never}>
      {children}
    </DesktopProductHostProvider>
  );
}

const AUTH_USER = {
  id: "u1",
  email: "ada@example.test",
  display_name: "Ada",
  github_login: "ada",
  avatar_url: null,
};

beforeEach(() => {
  h.cloudEnabled = true;
  h.authMethods = { passwordLogin: true, github: true };
  h.github = { enabled: true, clientId: null };
  h.sso = { enabled: true };
  h.getProliferateClient.mockClear();
  cloudClient = { id: "cloud-1" };
  useAuthStore.setState({
    status: "anonymous",
    user: null,
    session: null,
    error: null,
    issue: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DesktopProductHostProvider", () => {
  it("exposes surface desktop, a non-null bridge, and the exact cloud client", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    expect(result.current.surface).toBe("desktop");
    expect(result.current.desktop).toBe(h.desktopBridge);
    expect(result.current.cloud.client).toBe(cloudClient);
  });

  it("does not construct a second Cloud client", () => {
    renderHook(() => useProductHost(), { wrapper });
    expect(h.getProliferateClient).not.toHaveBeenCalled();
  });

  it("replaces the host and remaps the user when auth status changes", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const anonymousHost = result.current;
    expect(anonymousHost.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "github", "sso"],
    });

    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });

    const authedHost = result.current;
    expect(authedHost).not.toBe(anonymousHost);
    expect(authedHost.auth.state).toEqual({
      status: "authenticated",
      user: {
        id: "u1",
        displayName: "Ada",
        email: "ada@example.test",
        avatarUrl: null,
        githubLogin: "ada",
      },
      readiness: { status: "ready" },
    });
  });

  it("keeps static host groups identical across an auth replacement", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;

    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const after = result.current;

    expect(after).not.toBe(before);
    expect(after.auth).not.toBe(before.auth);
    expect(after.storage).toBe(before.storage);
    expect(after.links).toBe(before.links);
    expect(after.clipboard).toBe(before.clipboard);
    expect(after.telemetry).toBe(before.telemetry);
    expect(after.deployment).toBe(before.deployment);
    expect(after.desktop).toBe(before.desktop);
  });

  it("replaces the host when an authenticated identity field changes", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;

    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        user: { ...AUTH_USER, display_name: "Ada Lovelace" },
      });
    });

    expect(result.current).not.toBe(before);
    expect(result.current.auth.state).toMatchObject({
      status: "authenticated",
      user: { displayName: "Ada Lovelace" },
    });
  });

  it("does not replace the host when identity fields change while anonymous", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;
    expect(before.auth.state).toMatchObject({ status: "anonymous" });

    // Retained user data mutates while anonymous — the AuthState carries no
    // user here, so this must not replace the host.
    act(() => {
      useAuthStore.setState({ status: "anonymous", user: AUTH_USER });
    });

    expect(result.current).toBe(before);
  });

  it("does not replace the host when identity fields change while bootstrapping", () => {
    act(() => {
      useAuthStore.setState({ status: "bootstrapping", user: null });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;
    expect(before.auth.state).toMatchObject({ status: "loading" });

    act(() => {
      useAuthStore.setState({ status: "bootstrapping", user: AUTH_USER });
    });

    expect(result.current).toBe(before);
  });

  it("replaces the host when identity fields change while authenticated", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;

    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        user: { ...AUTH_USER, email: "ada.lovelace@example.test" },
      });
    });

    expect(result.current).not.toBe(before);
    expect(result.current.auth.state).toMatchObject({
      status: "authenticated",
      user: { email: "ada.lovelace@example.test" },
    });
  });

  it("does not replace the host on token rotation or unrelated rerenders", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const { result, rerender } = renderHook(() => useProductHost(), {
      wrapper,
    });
    const host = result.current;

    // A token/session rotation touches no identity field the provider reads.
    act(() => {
      useAuthStore.setState({
        session: { access_token: "rotated" } as never,
      });
    });
    expect(result.current).toBe(host);

    // A parent re-render with unchanged inputs preserves host identity.
    act(() => {
      rerender();
    });
    expect(result.current).toBe(host);
  });

  it("replaces the host when the anonymous method list changes", () => {
    const { result, rerender } = renderHook(() => useProductHost(), {
      wrapper,
    });
    const before = result.current;
    expect(before.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "github", "sso"],
    });

    h.github = { enabled: false };
    act(() => {
      rerender();
    });

    expect(result.current).not.toBe(before);
    expect(result.current.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "sso"],
    });
  });

  it("does not replace the host when method availability changes while authenticated", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const { result, rerender } = renderHook(() => useProductHost(), {
      wrapper,
    });
    const before = result.current;

    h.github = { enabled: false };
    act(() => {
      rerender();
    });

    expect(result.current).toBe(before);
  });

  it("replaces the host and exposes the exact new client when cloudClient changes", () => {
    const { result, rerender } = renderHook(() => useProductHost(), {
      wrapper,
    });
    const before = result.current;

    const nextClient = { id: "cloud-2" };
    cloudClient = nextClient;
    act(() => {
      rerender();
    });

    expect(result.current).not.toBe(before);
    expect(result.current.cloud.client).toBe(nextClient);
  });

  it("exposes a non-null Cloud client while anonymous", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    expect(result.current.auth.state).toMatchObject({ status: "anonymous" });
    // Anonymity does not disable authority-capable transport.
    expect(result.current.cloud.client).toBe(cloudClient);
  });

  it("publishes an anonymous deployment_unreachable issue and replaces on issue change", () => {
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;
    expect(before.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "github", "sso"],
    });

    act(() => {
      useAuthStore.setState({
        status: "anonymous",
        issue: { kind: "deployment_unreachable" },
      });
    });

    expect(result.current).not.toBe(before);
    expect(result.current.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "github", "sso"],
      issue: { kind: "deployment_unreachable" },
    });
  });

  it("publishes an anonymous callback_failed issue with its provider code", () => {
    act(() => {
      useAuthStore.setState({
        status: "anonymous",
        issue: {
          kind: "callback_failed",
          reason: "provider_error",
          providerCode: "access_denied",
        },
      });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });

    expect(result.current.auth.state).toEqual({
      status: "anonymous",
      methods: ["password", "github", "sso"],
      issue: {
        kind: "callback_failed",
        reason: "provider_error",
        providerCode: "access_denied",
      },
    });
  });

  it("maps the authenticated cached-session degraded path to user null and ready", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: null });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });

    expect(result.current.auth.state).toEqual({
      status: "authenticated",
      user: null,
      readiness: { status: "ready" },
    });
  });

  it("does not replace the host when an issue changes while authenticated", () => {
    act(() => {
      useAuthStore.setState({ status: "authenticated", user: AUTH_USER });
    });
    const { result } = renderHook(() => useProductHost(), { wrapper });
    const before = result.current;

    // A stale issue arriving behind a signed-in session must not regress it.
    act(() => {
      useAuthStore.setState({
        issue: { kind: "callback_failed", reason: "expired" },
      });
    });

    expect(result.current).toBe(before);
    expect(result.current.auth.state).toMatchObject({
      status: "authenticated",
    });
  });
});
