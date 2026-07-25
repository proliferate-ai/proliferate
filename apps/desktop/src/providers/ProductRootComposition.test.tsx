// @vitest-environment jsdom

import { StrictMode, useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useAuthStore } from "@/stores/auth/auth-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useOrganizationStore } from "@/stores/organizations/organization-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const state = vi.hoisted(() => {
  const cloudClient = { kind: "one-cloud-client" };
  const queryClient = { kind: "one-query-client" };
  const telemetry = {
    track: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
    setTag: vi.fn(),
    routeChanged: vi.fn(),
    getSupportContext: vi.fn(() => ({ clientReleaseId: "desktop@test" })),
  };
  const constructedQueryClients: unknown[] = [];
  return {
    cloudClient,
    queryClient,
    telemetry,
    constructedQueryClients,
    createQueryClient: vi.fn(() => {
      constructedQueryClients.push(queryClient);
      return queryClient;
    }),
    getCloudClient: vi.fn(() => cloudClient),
    queryProviderClients: [] as unknown[],
    cloudProviderClients: [] as unknown[],
    committedHosts: [] as unknown[],
    restoreSession: vi.fn(async () => {}),
    authActions: {
      signInWithGitHub: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithSso: vi.fn(),
      signOut: vi.fn(),
      cancelAuthFlow: vi.fn(),
      linkGoogle: vi.fn(),
    },
    authOperations: {
      startLogin: vi.fn(),
      finishLogin: vi.fn(),
      cancelLogin: vi.fn(),
      logout: vi.fn(),
    },
    runtimeHealth: {
      agentSeed: {
        status: "ready",
        seedVersion: "seed-1",
        failureKind: null,
        source: "bundled",
        ownership: "full_seed",
        lastAction: "hydrated",
        seededAgents: ["codex"],
        seedOwnedArtifactCount: 2,
        skippedExistingArtifactCount: 0,
        repairedArtifactCount: 0,
      },
    } as unknown,
    desktopBridge: {
      diagnostics: {
        logEvent: vi.fn(async () => {}),
        recordBootEvent: vi.fn(),
        recordBootEventOnce: vi.fn(),
        recordStartupEvent: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/infra/query/query-client", () => ({
  createAppQueryClient: state.createQueryClient,
}));
vi.mock("@/lib/access/cloud/client", () => ({
  getProliferateClient: state.getCloudClient,
}));
vi.mock("@tanstack/react-query", () => ({
  QueryClientProvider: ({ children, client }: { children: ReactNode; client: unknown }) => {
    state.queryProviderClients.push(client);
    return <div data-testid="query-provider">{children}</div>;
  },
}));
vi.mock("@proliferate/cloud-sdk-react", () => ({
  CloudClientProvider: ({ children, client }: { children: ReactNode; client: unknown }) => {
    state.cloudProviderClients.push(client);
    return <div data-testid="cloud-provider">{children}</div>;
  },
}));
vi.mock("@anyharness/sdk-react", () => ({
  AnyHarnessRuntime: ({ children }: { children: ReactNode }) => (
    <div data-testid="runtime-provider">{children}</div>
  ),
  AnyHarnessWorkspace: ({ children }: { children: ReactNode }) => (
    <div data-testid="workspace-provider">{children}</div>
  ),
  useRuntimeHealthQuery: () => ({ data: state.runtimeHealth }),
}));

vi.mock("@/hooks/workspaces/cache/use-product-workspace-provider", () => ({
  useProductWorkspaceProvider: () => ({
    runtimeUrl: "http://127.0.0.1:8457",
    cacheScopeKey: "desktop::anonymous",
    providerWorkspaceId: "local-workspace",
    resolveConnection: vi.fn(),
  }),
}));
vi.mock("@/hooks/workspaces/cache/use-cloud-workspace-materialization-cache-boundary", () => ({
  useCloudWorkspaceMaterializationCacheBoundary: vi.fn(),
}));

vi.mock("@/hooks/auth/lifecycle/use-auth-bootstrap", () => ({
  useAuthBootstrap: () => state.restoreSession,
}));
vi.mock("@/hooks/auth/workflows/use-auth-actions", () => ({
  useAuthActions: () => state.authActions,
}));
vi.mock("@/hooks/auth/workflows/use-auth-orchestration-effects", () => ({
  useAuthOrchestrationEffects: () => ({}),
}));
vi.mock("@/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilitiesAtApiBaseUrl: () => ({ cloudEnabled: true }),
}));
vi.mock("@/hooks/access/cloud/auth/use-auth-methods", () => ({
  useDesktopAuthMethodsAtApiBaseUrl: () => ({ data: { passwordLogin: true } }),
}));
vi.mock("@/hooks/access/cloud/auth/use-github-auth-availability", () => ({
  useGitHubDesktopAuthAvailabilityAtApiBaseUrl: () => ({ data: { enabled: true } }),
}));
vi.mock("@/hooks/access/cloud/auth/use-sso-discovery", () => ({
  useSsoDiscoveryAtApiBaseUrl: () => ({ data: { enabled: true } }),
}));
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isProductAuthRequired: () => true,
}));
vi.mock("@/lib/access/browser/product-storage", () => ({
  desktopProductStorage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/access/tauri/desktop-bridge", () => ({
  desktopBridge: state.desktopBridge,
}));
vi.mock("./desktop-product-host", () => ({
  buildAnonymousMethods: () => ["password", "github", "sso"],
  createDesktopAuthOperations: () => state.authOperations,
  createDesktopDeployment: () => ({ apiBaseUrl: "https://api.example.test" }),
  desktopClipboard: { writeText: vi.fn(async () => {}) },
  desktopProductLinks: {
    openExternal: vi.fn(async () => {}),
    buildReturnUrl: vi.fn(() => "proliferate://return"),
    observeInboundEntries: vi.fn(() => () => {}),
  },
  desktopTelemetry: state.telemetry,
  mapProductAuthUser: (user: { id: string; email: string; display_name: string | null }) => ({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
  }),
}));

vi.mock("@/hooks/app/lifecycle/use-connectivity-listeners", () => ({
  useConnectivityListeners: vi.fn(),
}));
vi.mock("@/hooks/app/lifecycle/use-product-entry-routing", () => ({
  useProductEntryRouting: vi.fn(),
}));
vi.mock("@/hooks/organizations/lifecycle/use-organization-join-auth-launch", () => ({
  useOrganizationJoinAuthLaunch: vi.fn(),
}));
vi.mock("@/hooks/app/lifecycle/use-app-shortcuts", () => ({
  useAppShortcuts: vi.fn(),
}));
vi.mock("@/hooks/home/lifecycle/use-home-deferred-launch-runner", () => ({
  useHomeDeferredLaunchRunner: vi.fn(),
}));
vi.mock("@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle", () => ({
  useAppearancePreferenceLifecycle: vi.fn(),
}));
vi.mock("@/hooks/preferences/lifecycle/use-product-persistence-lifecycles", () => ({
  useProductPersistenceLifecycles: vi.fn(),
}));
vi.mock("@/hooks/sessions/lifecycle/use-session-intent-dispatcher", () => ({
  useSessionIntentDispatcher: vi.fn(),
}));
vi.mock("@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher", () => ({
  useShortcutDispatcher: vi.fn(),
}));
vi.mock("@/hooks/support/lifecycle/use-support-report-upload-queue", () => ({
  useSupportReportUploadQueue: vi.fn(),
}));
vi.mock("@/hooks/sessions/lifecycle/use-turn-end-sound", () => ({
  useTurnEndSound: vi.fn(),
}));
vi.mock("@/hooks/terminals/lifecycle/use-terminal-stream-authority-lifecycle", () => ({
  useTerminalStreamAuthorityLifecycle: vi.fn(),
}));
vi.mock("@/hooks/workspaces/lifecycle/use-workspace-git-status-persistence", () => ({
  useWorkspaceGitStatusPersistence: vi.fn(),
}));
vi.mock("@/hooks/app/workflows/use-app-command-actions", () => ({
  useAppCommandActions: () => ({}),
}));
vi.mock("./AppCommandActionsProvider", () => ({
  AppCommandActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./DesktopProductLifecycleRoot", () => ({
  DesktopProductLifecycleRoot: () => null,
}));

import { DesktopHostProviders } from "./DesktopHostProviders";
import { ProductLifecycleRoot } from "./ProductLifecycleRoot";
import { ProductProviderRoot } from "./ProductProviderRoot";

function HostProbe() {
  const host = useProductHost();
  useEffect(() => {
    state.committedHosts.push(host);
  }, [host]);
  return <div data-testid="host-probe" />;
}

function Composition() {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={["/settings"]}>
        <DesktopHostProviders>
          <ProductProviderRoot>
            <ProductLifecycleRoot>
              <HostProbe />
            </ProductLifecycleRoot>
          </ProductProviderRoot>
        </DesktopHostProviders>
      </MemoryRouter>
    </StrictMode>
  );
}

function productEventCount(name: string): number {
  return state.telemetry.track.mock.calls.filter(([event]) => event.name === name).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.queryProviderClients.length = 0;
  state.cloudProviderClients.length = 0;
  state.committedHosts.length = 0;
  state.runtimeHealth = {
    agentSeed: {
      status: "ready",
      seedVersion: "seed-1",
      failureKind: null,
      source: "bundled",
      ownership: "full_seed",
      lastAction: "hydrated",
      seededAgents: ["codex"],
      seedOwnedArtifactCount: 2,
      skippedExistingArtifactCount: 0,
      repairedArtifactCount: 0,
    },
  };
  useAuthStore.setState({
    status: "anonymous",
    user: null,
    session: null,
    error: null,
    issue: null,
  });
  useOrganizationStore.setState({
    activeOrganizationId: "org-1",
    activeOrganizationValidated: true,
  });
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://127.0.0.1:8457",
    connectionState: "healthy",
    error: null,
  });
  useSessionSelectionStore.setState({ selectedWorkspaceId: "local-workspace" });
});

afterEach(() => {
  cleanup();
});

describe("Desktop product root composition", () => {
  it("keeps one provider identity and delegates each telemetry transition once", () => {
    const first = render(<Composition />);

    const queryProvider = screen.getByTestId("query-provider");
    const cloudProvider = screen.getByTestId("cloud-provider");
    const runtimeProvider = screen.getByTestId("runtime-provider");
    const workspaceProvider = screen.getByTestId("workspace-provider");
    const hostProbe = screen.getByTestId("host-probe");
    expect(queryProvider.contains(cloudProvider)).toBe(true);
    expect(cloudProvider.contains(runtimeProvider)).toBe(true);
    expect(runtimeProvider.contains(workspaceProvider)).toBe(true);
    expect(workspaceProvider.contains(hostProbe)).toBe(true);

    expect(state.constructedQueryClients).toEqual([state.queryClient]);
    expect(state.queryProviderClients.every((client) => client === state.queryClient)).toBe(true);
    expect(state.cloudProviderClients.every((client) => client === state.cloudClient)).toBe(true);
    expect(state.committedHosts.length).toBeGreaterThan(0);
    expect(state.committedHosts.every((host) => host === state.committedHosts[0])).toBe(true);
    expect((state.committedHosts[0] as { cloud: { client: unknown } }).cloud.client).toBe(
      state.cloudClient,
    );

    expect(state.telemetry.setUser).toHaveBeenCalledTimes(1);
    expect(state.telemetry.setUser).toHaveBeenCalledWith(null);
    expect(state.telemetry.setTag).toHaveBeenCalledWith("auth_status", "anonymous");
    expect(state.telemetry.setTag).toHaveBeenCalledWith("organization_id", "org-1");
    expect(productEventCount("screen_viewed")).toBe(1);
    expect(productEventCount("runtime_connection_state_changed")).toBe(1);
    expect(productEventCount("workspace_selected")).toBe(1);
    expect(productEventCount("agent_seed_hydrated")).toBe(1);
    expect(state.telemetry.routeChanged).toHaveBeenCalledTimes(1);

    first.rerender(<Composition />);
    expect(productEventCount("screen_viewed")).toBe(1);
    expect(productEventCount("runtime_connection_state_changed")).toBe(1);
    expect(productEventCount("workspace_selected")).toBe(1);
    expect(productEventCount("agent_seed_hydrated")).toBe(1);

    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        user: {
          id: "user-1",
          email: "user@example.test",
          display_name: "User",
          github_login: null,
          avatar_url: null,
        },
      });
      useOrganizationStore.getState().setActiveOrganizationId("org-2", {
        validated: true,
      });
      useHarnessConnectionStore.setState({ connectionState: "failed", error: "offline" });
      useSessionSelectionStore.setState({ selectedWorkspaceId: "cloud:cloud-1" });
    });

    expect(state.telemetry.setUser).toHaveBeenCalledTimes(2);
    expect(state.telemetry.setTag).toHaveBeenCalledWith("auth_status", "authenticated");
    expect(state.telemetry.setTag).toHaveBeenCalledWith("organization_id", "org-2");
    expect(productEventCount("runtime_connection_state_changed")).toBe(2);
    expect(productEventCount("workspace_selected")).toBe(2);

    const callsBeforeUnmount = state.telemetry.track.mock.calls.length;
    first.unmount();
    act(() => {
      useOrganizationStore.getState().setActiveOrganizationId("org-after-unmount");
      useHarnessConnectionStore.setState({ connectionState: "healthy" });
      useSessionSelectionStore.setState({ selectedWorkspaceId: "after-unmount" });
    });
    expect(state.telemetry.track).toHaveBeenCalledTimes(callsBeforeUnmount);

    render(<Composition />);
    expect(productEventCount("screen_viewed")).toBe(2);
    expect(productEventCount("runtime_connection_state_changed")).toBe(3);
    expect(productEventCount("workspace_selected")).toBe(3);
    expect(productEventCount("agent_seed_hydrated")).toBe(2);
  });
});
