// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

// Every shared lifecycle hook is a no-op stub; this test exercises the root's
// composition (children pass-through, Desktop lifecycle mount, auth restore,
// command-actions context), not the individual lifecycles.
// One shared lifecycle hook can be told to throw during render, to prove the
// root's error boundary contains it rather than letting it escape to the host.
const lifecycleThrow = vi.hoisted(() => ({ value: false }));
vi.mock("#product/hooks/app/lifecycle/use-connectivity-listeners", () => ({
  useConnectivityListeners: () => {
    if (lifecycleThrow.value) {
      throw new Error("lifecycle boom");
    }
  },
}));
vi.mock("@/lib/integrations/telemetry/native-diagnostics", () => ({
  reportReactRenderError: vi.fn(),
}));
vi.mock("#product/hooks/app/lifecycle/use-debug-session-activity", () => ({ useDebugSessionActivity: vi.fn() }));
vi.mock("#product/hooks/app/lifecycle/use-dev-desktop-handoff", () => ({ useDevDesktopHandoff: vi.fn() }));
vi.mock("#product/hooks/app/lifecycle/use-product-entry-routing", () => ({ useProductEntryRouting: vi.fn() }));
vi.mock("#product/hooks/organizations/lifecycle/use-organization-join-auth-launch", () => ({ useOrganizationJoinAuthLaunch: vi.fn() }));
vi.mock("#product/hooks/app/lifecycle/use-app-shortcuts", () => ({ useAppShortcuts: vi.fn() }));
vi.mock("#product/hooks/app/workflows/use-app-command-actions", () => ({
  useAppCommandActions: () => ({ __brand: "app-command-actions" }),
}));
vi.mock("#product/hooks/agents/lifecycle/use-agent-auto-reconcile", () => ({ useAgentAutoReconcile: vi.fn() }));
vi.mock("#product/hooks/agents/lifecycle/use-first-run-auth-adoption", () => ({ useFirstRunAuthAdoption: vi.fn() }));
vi.mock("#product/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync", () => ({ useGatewayCatalogMirrorSync: vi.fn() }));
vi.mock("#product/hooks/agents/lifecycle/use-local-auth-state-sync", () => ({ useLocalAuthStateSync: vi.fn() }));
vi.mock("#product/hooks/automations/lifecycle/use-local-automation-executor", () => ({ useLocalAutomationExecutor: vi.fn() }));
vi.mock("#product/hooks/home/lifecycle/use-home-deferred-launch-runner", () => ({ useHomeDeferredLaunchRunner: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-appearance-preference-lifecycle", () => ({ useAppearancePreferenceLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-repo-preferences-lifecycle", () => ({ useRepoPreferencesLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-user-preferences-lifecycle", () => ({ useUserPreferencesLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-workspace-ui-lifecycle", () => ({ useWorkspaceUiLifecycle: vi.fn() }));
vi.mock("#product/hooks/persistence/lifecycle/use-product-storage-persistence-lifecycle", () => ({ useProductStoragePersistenceLifecycle: vi.fn() }));
vi.mock("#product/hooks/sessions/lifecycle/use-session-intent-dispatcher", () => ({ useSessionIntentDispatcher: vi.fn() }));
vi.mock("#product/hooks/sessions/lifecycle/use-session-selection-lifecycle", () => ({ useSessionSelectionLifecycle: vi.fn() }));
vi.mock("#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher", () => ({ useShortcutDispatcher: vi.fn() }));
vi.mock("#product/hooks/support/lifecycle/use-support-report-upload-queue", () => ({ useSupportReportUploadQueue: vi.fn() }));
vi.mock("#product/hooks/sessions/lifecycle/use-turn-end-sound", () => ({ useTurnEndSound: vi.fn() }));
vi.mock("#product/hooks/workspaces/lifecycle/use-workspace-git-status-persistence", () => ({ useWorkspaceGitStatusPersistence: vi.fn() }));
vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({ useProductAuthStatus: () => "loading" }));
vi.mock("#product/lib/infra/measurement/measurement-port", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/infra/measurement/measurement-port")
  >()),
  elapsedStartupMs: () => 0,
  logStartupDebug: vi.fn(),
  startStartupTimer: () => 0,
  recordBootDiagnostic: vi.fn(),
  recordBootDiagnosticOnce: vi.fn(),
}));

const desktopLifecycleMountCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("#product/providers/DesktopProductLifecycleRoot", () => ({
  DesktopProductLifecycleRoot: () => {
    desktopLifecycleMountCount.value += 1;
    return <div data-testid="desktop-lifecycle-root" />;
  },
}));

import { ProductLifecycleRoot } from "#product/providers/ProductLifecycleRoot";
import { useAppCommandActionsContext } from "#product/providers/AppCommandActionsProvider";

function CommandContextProbe() {
  const actions = useAppCommandActionsContext();
  return <div data-testid="command-context">{String(Boolean(actions))}</div>;
}

afterEach(() => {
  cleanup();
  desktopLifecycleMountCount.value = 0;
  lifecycleThrow.value = false;
  vi.clearAllMocks();
});

describe("ProductLifecycleRoot", () => {
  it("renders the product tree, mounts the Desktop lifecycle root, and provides command actions", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    const host = makeTestProductHost({ auth: { restoreSession } });

    render(
      <ProductHostProvider host={host}>
        <ProductLifecycleRoot>
          <div data-testid="app-tree">app</div>
          <CommandContextProbe />
        </ProductLifecycleRoot>
      </ProductHostProvider>,
    );

    // Product route/UI tree renders beneath the lifecycle root.
    expect(screen.getByTestId("app-tree")).toBeTruthy();
    // The capability-gated Desktop lifecycle root is mounted exactly once.
    expect(screen.getAllByTestId("desktop-lifecycle-root")).toHaveLength(1);
    // The command-actions context is provided to the product tree.
    expect(screen.getByTestId("command-context").textContent).toBe("true");
    // The auth restore effect fires through the host boundary.
    await waitFor(() => expect(restoreSession).toHaveBeenCalled());
  });

  it("contains a render-phase throw from a shared lifecycle hook in the error boundary", () => {
    lifecycleThrow.value = true;
    // React logs the caught render error to console.error; silence it so the
    // test output stays clean while still asserting the boundary caught it.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });

    render(
      <ProductHostProvider host={host}>
        <ProductLifecycleRoot>
          <div data-testid="app-tree">app</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>,
    );

    // The boundary shows its fallback instead of letting the lifecycle throw
    // escape the product lifecycle root; the product tree does not render.
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByTestId("app-tree")).toBeNull();

    consoleError.mockRestore();
  });

  it("keeps a single Desktop lifecycle mount under StrictMode", () => {
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });

    render(
      <StrictMode>
        <ProductHostProvider host={host}>
          <ProductLifecycleRoot>
            <div data-testid="app-tree">app</div>
          </ProductLifecycleRoot>
        </ProductHostProvider>
      </StrictMode>,
    );

    // One live Desktop lifecycle root in the DOM despite StrictMode double-render.
    expect(screen.getAllByTestId("desktop-lifecycle-root")).toHaveLength(1);
    expect(screen.getByTestId("app-tree")).toBeTruthy();
  });
});
