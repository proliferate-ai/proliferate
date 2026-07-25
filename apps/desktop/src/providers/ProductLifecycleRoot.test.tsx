// @vitest-environment jsdom
import { type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

const lifecycleState = vi.hoisted(() => ({
  desktopCleanups: 0,
  desktopMounts: 0,
  desktopRenders: 0,
  useAppCommandActions: vi.fn(() => ({ command: "actions" })),
  useAppShortcuts: vi.fn(),
  useAppearancePreferenceLifecycle: vi.fn(),
  useConnectivityListeners: vi.fn(),
  useHomeDeferredLaunchRunner: vi.fn(),
  useOrganizationJoinAuthLaunch: vi.fn(),
  useProductEntryRouting: vi.fn(),
  useProductPersistenceLifecycles: vi.fn(),
  useSessionIntentDispatcher: vi.fn(),
  useShortcutDispatcher: vi.fn(),
  useSupportReportUploadQueue: vi.fn(),
  useTerminalStreamAuthorityLifecycle: vi.fn(),
  useTurnEndSound: vi.fn(),
  useWorkspaceGitStatusPersistence: vi.fn(),
}));

vi.mock("@/hooks/app/lifecycle/use-connectivity-listeners", () => ({
  useConnectivityListeners: lifecycleState.useConnectivityListeners,
}));
vi.mock("@/hooks/app/lifecycle/use-product-entry-routing", () => ({
  useProductEntryRouting: lifecycleState.useProductEntryRouting,
}));
vi.mock("@/hooks/organizations/lifecycle/use-organization-join-auth-launch", () => ({
  useOrganizationJoinAuthLaunch: lifecycleState.useOrganizationJoinAuthLaunch,
}));
vi.mock("@/hooks/app/lifecycle/use-app-shortcuts", () => ({
  useAppShortcuts: lifecycleState.useAppShortcuts,
}));
vi.mock("@/hooks/app/workflows/use-app-command-actions", () => ({
  useAppCommandActions: lifecycleState.useAppCommandActions,
}));
vi.mock("@/hooks/home/lifecycle/use-home-deferred-launch-runner", () => ({
  useHomeDeferredLaunchRunner: lifecycleState.useHomeDeferredLaunchRunner,
}));
vi.mock("@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle", () => ({
  useAppearancePreferenceLifecycle:
    lifecycleState.useAppearancePreferenceLifecycle,
}));
vi.mock("@/hooks/preferences/lifecycle/use-product-persistence-lifecycles", () => ({
  useProductPersistenceLifecycles:
    lifecycleState.useProductPersistenceLifecycles,
}));
vi.mock("@/hooks/sessions/lifecycle/use-session-intent-dispatcher", () => ({
  useSessionIntentDispatcher: lifecycleState.useSessionIntentDispatcher,
}));
vi.mock("@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher", () => ({
  useShortcutDispatcher: lifecycleState.useShortcutDispatcher,
}));
vi.mock("@/hooks/support/lifecycle/use-support-report-upload-queue", () => ({
  useSupportReportUploadQueue: lifecycleState.useSupportReportUploadQueue,
}));
vi.mock("@/hooks/sessions/lifecycle/use-turn-end-sound", () => ({
  useTurnEndSound: lifecycleState.useTurnEndSound,
}));
vi.mock("@/hooks/terminals/lifecycle/use-terminal-stream-authority-lifecycle", () => ({
  useTerminalStreamAuthorityLifecycle:
    lifecycleState.useTerminalStreamAuthorityLifecycle,
}));
vi.mock("@/hooks/workspaces/lifecycle/use-workspace-git-status-persistence", () => ({
  useWorkspaceGitStatusPersistence:
    lifecycleState.useWorkspaceGitStatusPersistence,
}));

vi.mock("@/lib/infra/measurement/debug-startup", () => ({
  elapsedStartupMs: vi.fn(() => 1),
  logStartupDebug: vi.fn(),
  startStartupTimer: vi.fn(() => 0),
}));
vi.mock("@/lib/infra/measurement/boot-stall-diagnostics", () => ({
  recordBootDiagnostic: vi.fn(),
  recordBootDiagnosticOnce: vi.fn(),
}));

vi.mock("./AppCommandActionsProvider", () => ({
  AppCommandActionsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./DesktopProductLifecycleRoot", async () => {
  const { useEffect } = await import("react");
  return {
    DesktopProductLifecycleRoot: () => {
      lifecycleState.desktopRenders += 1;
      useEffect(() => {
        lifecycleState.desktopMounts += 1;
        return () => {
          lifecycleState.desktopCleanups += 1;
        };
      }, []);
      return <div data-testid="desktop-product-lifecycles" />;
    },
  };
});

import { ProductLifecycleRoot } from "./ProductLifecycleRoot";

const sharedLifecycleMocks = [
  lifecycleState.useConnectivityListeners,
  lifecycleState.useProductEntryRouting,
  lifecycleState.useOrganizationJoinAuthLaunch,
  lifecycleState.useShortcutDispatcher,
  lifecycleState.useAppShortcuts,
  lifecycleState.useTurnEndSound,
  lifecycleState.useHomeDeferredLaunchRunner,
  lifecycleState.useProductPersistenceLifecycles,
  lifecycleState.useAppearancePreferenceLifecycle,
  lifecycleState.useWorkspaceGitStatusPersistence,
  lifecycleState.useSessionIntentDispatcher,
  lifecycleState.useSupportReportUploadQueue,
  lifecycleState.useTerminalStreamAuthorityLifecycle,
];

function makeHost(
  desktop: DesktopBridge | null,
  restoreSession = vi.fn().mockResolvedValue(undefined),
): ProductHost {
  return {
    surface: desktop === null ? "web" : "desktop",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "anonymous", methods: [] },
      restoreSession,
      startLogin: async () => ({ provider: "github", source: "desktop_callback" }),
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => ({ provider: "github" }),
    },
    cloud: { client: null },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    links: {
      openExternal: async () => {},
      buildReturnUrl: () => "",
      observeInboundEntries: () => () => {},
    },
    clipboard: { writeText: async () => {} },
    telemetry: {
      track: () => {},
      captureException: () => {},
      setUser: () => {},
      setTag: () => {},
      routeChanged: () => {},
      getSupportContext: () => ({ clientReleaseId: "test" }),
    },
    desktop,
  };
}

function renderRoot(host: ProductHost) {
  return render(
    <ProductHostProvider host={host}>
      <ProductLifecycleRoot>
        <div>shared product child</div>
      </ProductLifecycleRoot>
    </ProductHostProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lifecycleState.desktopCleanups = 0;
  lifecycleState.desktopMounts = 0;
  lifecycleState.desktopRenders = 0;
});

afterEach(() => {
  cleanup();
});

describe("ProductLifecycleRoot", () => {
  it("delegates the retained Desktop boot and auth-startup markers", async () => {
    const diagnostics = {
      logEvent: vi.fn().mockResolvedValue(undefined),
      recordBootEvent: vi.fn(),
      recordBootEventOnce: vi.fn(),
      recordStartupEvent: vi.fn(),
    };
    const restoreSession = vi.fn().mockResolvedValue(undefined);

    renderRoot(
      makeHost({ diagnostics } as unknown as DesktopBridge, restoreSession),
    );
    await act(async () => {});

    const onceLabels = diagnostics.recordBootEventOnce.mock.calls.map(
      ([payload]) => payload.label,
    );
    expect(onceLabels).toContain(
      "app_runtime.render.before.use_auth_bootstrap",
    );
    expect(onceLabels).toContain(
      "app_runtime.render.after.use_auth_bootstrap",
    );
    expect(onceLabels).toContain("app_runtime.render.before_return");
    expect(diagnostics.recordStartupEvent).toHaveBeenNthCalledWith(1, {
      message: "app.bootstrap.start",
    });
    expect(diagnostics.recordStartupEvent).toHaveBeenNthCalledWith(2, {
      message: "app.auth_bootstrap.start",
    });
    expect(diagnostics.recordStartupEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: "app.auth_bootstrap.completed",
        authStatus: "anonymous",
      }),
    );
    expect(restoreSession).toHaveBeenCalledTimes(1);
  });

  it("mounts shared product behavior but no Desktop subtree for desktop: null", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    renderRoot(makeHost(null, restoreSession));
    await act(async () => {});

    expect(screen.getByText("shared product child")).toBeTruthy();
    expect(restoreSession).toHaveBeenCalledTimes(1);
    expect(lifecycleState.useAppCommandActions).toHaveBeenCalledTimes(1);
    for (const lifecycle of sharedLifecycleMocks) {
      expect(lifecycle).toHaveBeenCalledTimes(1);
    }
    expect(lifecycleState.desktopRenders).toBe(0);
    expect(lifecycleState.desktopMounts).toBe(0);
    expect(lifecycleState.desktopCleanups).toBe(0);
  });

  it("mounts and cleans the Desktop subtree once as the host capability changes", () => {
    const bridge = {
      diagnostics: {
        logEvent: vi.fn().mockResolvedValue(undefined),
        recordBootEvent: vi.fn(),
        recordBootEventOnce: vi.fn(),
        recordStartupEvent: vi.fn(),
      },
    } as unknown as DesktopBridge;
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = renderRoot(makeHost(null, restoreSession));

    expect(lifecycleState.desktopMounts).toBe(0);

    rerender(
      <ProductHostProvider host={makeHost(bridge, restoreSession)}>
        <ProductLifecycleRoot>
          <div>shared product child</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>,
    );
    expect(lifecycleState.desktopMounts).toBe(1);
    expect(lifecycleState.desktopCleanups).toBe(0);

    // A replacement ProductHost snapshot carrying the same Desktop bridge
    // rerenders the subtree but does not remount its effects.
    rerender(
      <ProductHostProvider host={makeHost(bridge, restoreSession)}>
        <ProductLifecycleRoot>
          <div>shared product child</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>,
    );
    expect(lifecycleState.desktopMounts).toBe(1);
    expect(lifecycleState.desktopCleanups).toBe(0);

    rerender(
      <ProductHostProvider host={makeHost(null, restoreSession)}>
        <ProductLifecycleRoot>
          <div>shared product child</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>,
    );
    expect(lifecycleState.desktopCleanups).toBe(1);

    unmount();
    expect(lifecycleState.desktopCleanups).toBe(1);
  });
});
