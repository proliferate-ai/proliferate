// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

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
vi.mock("#product/hooks/agents/lifecycle/use-local-auth-state-sync", () => ({ useLocalAuthStateSync: vi.fn() }));
vi.mock("#product/hooks/home/lifecycle/use-home-deferred-launch-runner", () => ({ useHomeDeferredLaunchRunner: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-appearance-preference-lifecycle", () => ({ useAppearancePreferenceLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-repo-preferences-lifecycle", () => ({ useRepoPreferencesLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-user-preferences-lifecycle", () => ({ useUserPreferencesLifecycle: vi.fn() }));
vi.mock("#product/hooks/preferences/lifecycle/use-workspace-ui-lifecycle", () => ({ useWorkspaceUiLifecycle: vi.fn() }));
vi.mock("#product/hooks/persistence/lifecycle/use-product-storage-persistence-lifecycle", () => ({ useProductStoragePersistenceLifecycle: vi.fn() }));
vi.mock("#product/hooks/sessions/lifecycle/use-session-selection-lifecycle", () => ({ useSessionSelectionLifecycle: vi.fn() }));
vi.mock("#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher", () => ({ useShortcutDispatcher: vi.fn() }));
vi.mock("#product/hooks/support/workflows/use-crash-recovery-support-action", () => ({
  useCrashRecoverySupportAction: () => null,
}));
vi.mock("#product/hooks/sessions/lifecycle/use-turn-end-sound", () => ({ useTurnEndSound: vi.fn() }));
vi.mock("#product/hooks/workspaces/lifecycle/use-workspace-git-status-persistence", () => ({ useWorkspaceGitStatusPersistence: vi.fn() }));
// Mutable so tests can drive the authenticated-only lazy mounts (the support
// report queue, the launch lifecycles) by moving the shell between the
// signed-out and signed-in states; every other test keeps the pre-session
// status the login shell renders under.
const authStatus = vi.hoisted(() => ({
  value: "loading" as "loading" | "anonymous" | "authenticated",
}));
vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => authStatus.value,
}));
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

vi.mock("#product/components/agents/AuthRestartOfferRoot", () => ({
  AuthRestartOfferRoot: () => null,
}));

vi.mock("#product/providers/SupportReportQueueRoot", () => ({
  SupportReportQueueRoot: () => <div data-testid="support-report-queue-root" />,
}));

vi.mock("#product/providers/AuthenticatedBackgroundLifecycles", () => ({
  AuthenticatedBackgroundLifecycles: () => (
    <div data-testid="authenticated-background-lifecycles" />
  ),
}));

vi.mock("#product/providers/SessionIntentDispatcherLifecycle", () => ({
  SessionIntentDispatcherLifecycle: () => (
    <div data-testid="session-intent-dispatcher-lifecycle" />
  ),
}));

// Not mocked as a component (unlike AuthenticatedBackgroundLifecycles above):
// the real AuthenticatedWorkspaceSwitchShortcuts renders, but its underlying
// hook is mocked below, matching the stronger AuthenticatedLaunchLifecycles /
// useHomeDeferredLaunchRunner pattern -- so a regression that drops the
// `authStatus === "authenticated"` guard around it is actually caught (see
// "keeps the workspace-switch shortcuts off the signed-out shell..." below).
vi.mock("#product/hooks/app/lifecycle/use-workspace-switch-shortcuts", () => ({
  useWorkspaceSwitchShortcuts: vi.fn(),
}));

// Counted rather than stubbed away: where this hook runs relative to the auth
// gate is the behaviour under test, not an implementation detail.
const retentionSweepCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("#product/hooks/support/lifecycle/use-support-report-retention", () => ({
  useSupportReportRetentionLifecycle: () => {
    retentionSweepCount.value += 1;
  },
}));

const desktopLifecycleMountCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("#product/providers/DesktopProductLifecycleRoot", () => ({
  DesktopProductLifecycleRoot: () => {
    desktopLifecycleMountCount.value += 1;
    return <div data-testid="desktop-lifecycle-root" />;
  },
}));

import { ProductLifecycleRoot } from "#product/providers/ProductLifecycleRoot";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useAppCommandActionsContext } from "#product/providers/AppCommandActionsProvider";
import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner";
import { useWorkspaceSwitchShortcuts } from "#product/hooks/app/lifecycle/use-workspace-switch-shortcuts";

function CommandContextProbe() {
  const actions = useAppCommandActionsContext();
  return <div data-testid="command-context">{String(Boolean(actions))}</div>;
}

const rendererDiagnostic = vi.fn();

beforeEach(() => {
  setRendererDiagnosticsSink({ emit: rendererDiagnostic });
});

afterEach(() => {
  cleanup();
  desktopLifecycleMountCount.value = 0;
  retentionSweepCount.value = 0;
  lifecycleThrow.value = false;
  authStatus.value = "loading";
  useSessionIntentStore.setState({ entriesById: {}, intentIdsByClientSessionId: {} });
  resetRendererDiagnosticsSinkForTest();
  vi.clearAllMocks();
});

describe("ProductLifecycleRoot", () => {
  it("keeps a desktop-null ProductHost on the no-op renderer sink", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    resetRendererDiagnosticsSinkForTest();
    rendererDiagnostic.mockClear();

    render(
      <ProductHostProvider host={makeTestProductHost({
        desktop: null,
        auth: { restoreSession },
      })}>
        <ProductLifecycleRoot><div>web product</div></ProductLifecycleRoot>
      </ProductHostProvider>,
    );

    await waitFor(() => expect(restoreSession).toHaveBeenCalled());
    expect(rendererDiagnostic).not.toHaveBeenCalled();
  });

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
    await waitFor(() => expect(rendererDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "renderer.app_bootstrap.app.auth_bootstrap.completed",
        kind: "milestone",
      }),
    ));
    expect(rendererDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderer.app_bootstrap.app.bootstrap.start",
      kind: "milestone",
    }));
  });

  it("contains a render-phase throw from a shared lifecycle hook in the error boundary", async () => {
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
    expect(await screen.findByText("The app needs a quick reload")).toBeTruthy();
    expect(screen.queryByTestId("app-tree")).toBeNull();

    consoleError.mockRestore();
  });

  it("mounts the support-report upload owner only once authenticated", async () => {
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });
    // A fresh element per render: re-rendering the identical element object
    // lets React bail out, and the auth-status change would never be read.
    const tree = () => (
      <ProductHostProvider host={host}>
        <ProductLifecycleRoot>
          <div data-testid="app-tree">app</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>
    );

    // Pre-session: the owner is behind both an auth gate and a lazy import, so
    // the login shell parses none of the queue/upload modules. Waiting on the
    // Desktop root first proves a Suspense flush happened and the absence below
    // is a real gate rather than an unresolved lazy chunk.
    const { rerender } = render(tree());
    await waitFor(() => expect(screen.getByTestId("desktop-lifecycle-root")).toBeTruthy());
    expect(screen.queryByTestId("support-report-queue-root")).toBeNull();
    expect(screen.queryByTestId("authenticated-background-lifecycles")).toBeNull();

    authStatus.value = "authenticated";
    rerender(tree());

    expect(await screen.findByTestId("support-report-queue-root")).toBeTruthy();
    expect(await screen.findByTestId("authenticated-background-lifecycles")).toBeTruthy();
  });

  it("sweeps support-report retention with no session, where the queue owner never mounts", async () => {
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });

    for (const status of ["loading", "anonymous"] as const) {
      authStatus.value = status;
      retentionSweepCount.value = 0;

      render(
        <ProductHostProvider host={host}>
          <ProductLifecycleRoot>
            <div data-testid="app-tree">app</div>
          </ProductLifecycleRoot>
        </ProductHostProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("desktop-lifecycle-root")).toBeTruthy());

      // The two halves of the same claim. The owner that drains the queue and
      // reconciles staged bytes needs a Cloud session, so it is absent here --
      // and the account that signs out and never returns is exactly the one
      // whose queue document and staged bytes nothing would ever reap. So
      // retention has to run on the side of the gate the owner cannot reach.
      expect(screen.queryByTestId("support-report-queue-root")).toBeNull();
      expect(retentionSweepCount.value).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("keeps the launch lifecycles off the signed-out shell and mounts them once authenticated", async () => {
    // Residency AND reachability. Both loops must outlive the workspace shell:
    // mounted inside it they would stop the moment the user sits on Home or
    // /workflows — both of which null the selection ids and unmount the shell —
    // leaving parked cloud attempts unpolled and prompts sent into attempts
    // nothing will finalize (PRO-230 review finding 1). But the launch registry
    // only exists for a signed-in viewer, so they are mounted behind the
    // authenticated gate as a lazy chunk, which is what keeps the launch /
    // session-creation graph out of the login first-load budget.
    authStatus.value = "anonymous";
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });
    const tree = () => (
      <ProductHostProvider host={host}>
        <ProductLifecycleRoot>
          <div data-testid="app-tree">app</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>
    );

    const { rerender } = render(tree());

    expect(screen.getByTestId("app-tree")).toBeTruthy();
    expect(useHomeDeferredLaunchRunner).not.toHaveBeenCalled();

    authStatus.value = "authenticated";
    rerender(tree());

    await waitFor(() => expect(useHomeDeferredLaunchRunner).toHaveBeenCalled());
  });

  it("keeps the workspace-switch shortcuts off the signed-out shell and mounts them once authenticated", async () => {
    // Mirrors "keeps the launch lifecycles off the signed-out shell..." above:
    // the shortcuts' held-key traversal cursor and sidebar-target projection
    // only make sense for a signed-in viewer with workspaces, so the owner is
    // mounted behind the authenticated gate as a lazy chunk, which is what
    // keeps that code out of the login first-load budget. Asserting the
    // underlying hook call (rather than mocking the whole component away, as
    // AuthenticatedBackgroundLifecycles's mock does above) means a regression
    // that drops the auth gate around <AuthenticatedWorkspaceSwitchShortcuts />
    // actually fails this test.
    authStatus.value = "anonymous";
    const host = makeTestProductHost({
      auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
    });
    const tree = () => (
      <ProductHostProvider host={host}>
        <ProductLifecycleRoot>
          <div data-testid="app-tree">app</div>
        </ProductLifecycleRoot>
      </ProductHostProvider>
    );

    const { rerender } = render(tree());

    expect(screen.getByTestId("app-tree")).toBeTruthy();
    expect(useWorkspaceSwitchShortcuts).not.toHaveBeenCalled();

    authStatus.value = "authenticated";
    rerender(tree());

    await waitFor(() => expect(useWorkspaceSwitchShortcuts).toHaveBeenCalled());
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

describe("ProductLifecycleRoot session intent dispatcher", () => {
  // Draining the prompt outbox is local runtime work. Gating it on the product
  // session left anonymous and local-only clients able to create a session but
  // never able to send: the prompt stayed queued and the composer sat on
  // "Thinking" with no error. The dispatcher must mount on queued work.
  function renderRoot() {
    return render(
      <ProductHostProvider host={makeTestProductHost({
        auth: { restoreSession: vi.fn().mockResolvedValue(undefined) },
      })}>
        <ProductLifecycleRoot><div>product</div></ProductLifecycleRoot>
      </ProductHostProvider>,
    );
  }

  function queueIntent() {
    useSessionIntentStore.setState({
      entriesById: {
        "intent-1": {
          intentId: "intent-1",
          kind: "send_prompt",
          clientSessionId: "client-session-1",
        },
      },
      intentIdsByClientSessionId: { "client-session-1": ["intent-1"] },
    });
  }

  it("dispatches a queued prompt while the client is anonymous", async () => {
    authStatus.value = "anonymous";
    queueIntent();

    renderRoot();

    await waitFor(() => {
      expect(screen.getByTestId("session-intent-dispatcher-lifecycle")).toBeTruthy();
    });
  });

  it("still mounts the dispatcher for an authenticated client with no queue yet", async () => {
    authStatus.value = "authenticated";

    renderRoot();

    await waitFor(() => {
      expect(screen.getByTestId("session-intent-dispatcher-lifecycle")).toBeTruthy();
    });
  });

  it("keeps the dispatcher chunk off a signed-out first load with no queued work", async () => {
    authStatus.value = "anonymous";

    renderRoot();

    await waitFor(() => {
      expect(screen.getByText("product")).toBeTruthy();
    });
    expect(screen.queryByTestId("session-intent-dispatcher-lifecycle")).toBeNull();
  });

  it("leaves the authenticated-only background lifecycles gated on auth", async () => {
    authStatus.value = "anonymous";
    queueIntent();

    renderRoot();

    await waitFor(() => {
      expect(screen.getByTestId("session-intent-dispatcher-lifecycle")).toBeTruthy();
    });
    expect(screen.queryByTestId("authenticated-background-lifecycles")).toBeNull();
  });
});
