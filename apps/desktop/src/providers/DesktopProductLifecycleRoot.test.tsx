// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "@proliferate/product-client/host/desktop-bridge";
import type {
  AuthState,
  ProductHost,
} from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const runtimeMocks = vi.hoisted(() => ({
  bootstrapHarnessRuntime: vi.fn().mockResolvedValue(undefined),
}));
const lifecycleMocks = vi.hoisted(() => ({
  useUpdateRestartWatcher: vi.fn(),
  useDesktopWorkerEnrollment: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/runtime-bootstrap", () => ({
  bootstrapHarnessRuntime: runtimeMocks.bootstrapHarnessRuntime,
}));
vi.mock("@/hooks/access/tauri/use-update-restart-watcher", () => ({
  useUpdateRestartWatcher: lifecycleMocks.useUpdateRestartWatcher,
}));
vi.mock("@/hooks/cloud/lifecycle/use-desktop-worker-enrollment", () => ({
  useDesktopWorkerEnrollment: lifecycleMocks.useDesktopWorkerEnrollment,
}));

vi.mock("@proliferate/product-domain/sessions/activity", () => ({
  isSessionSlotBusy: (snapshot: { busy?: boolean } | null) =>
    snapshot?.busy === true,
}));
vi.mock("@/lib/domain/sessions/directory/directory-activity", () => ({
  activitySnapshotFromDirectoryEntry: (entry: unknown) => entry,
  // Also mocked because the session-directory store imports it at module load.
  activityFromTranscript: () => ({}),
}));
vi.mock("@/hooks/app/lifecycle/use-workspace-activity-indicator", () => ({
  useWorkspaceActivityIndicator: vi.fn(),
}));
vi.mock("@/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle", () => ({
  useDesktopZoomPreferenceLifecycle: vi.fn(),
}));

import { useWorkspaceActivityIndicator } from "@/hooks/app/lifecycle/use-workspace-activity-indicator";
import { useDesktopZoomPreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle";
import { DesktopProductLifecycleRoot } from "./DesktopProductLifecycleRoot";

type Entries = Record<string, { busy: boolean }>;

function setEntries(entries: Entries) {
  useSessionDirectoryStore.setState({ entriesById: entries as never });
}

function makeBridge(
  setRunningAgentCount: (count: number) => Promise<void>,
  nativeUiOverrides: Partial<DesktopBridge["nativeUi"]> = {},
) {
  return {
    runtime: {
      getConnection: vi.fn(),
      restart: vi.fn(),
    },
    diagnostics: {
      logEvent: vi.fn().mockResolvedValue(undefined),
    },
    updater: {
      isSupported: vi.fn(() => true),
    },
    worker: {},
    nativeUi: {
      setRunningAgentCount,
      subscribeMenuCommands: () => () => {},
      setWorkspaceActivity: async () => {},
      setZoom: async () => {},
      ...nativeUiOverrides,
    },
  } as unknown as DesktopBridge;
}

function makeHost(
  desktop: DesktopBridge | null,
  authStatus: ProductHost["auth"]["state"]["status"] = "loading",
): ProductHost {
  return {
    surface: desktop ? "desktop" : "web",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: makeAuthState(authStatus),
      restoreSession: async () => {},
      startLogin: async () => {},
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => {},
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

function makeAuthState(status: AuthState["status"]): AuthState {
  if (status === "authenticated") {
    return { status, user: { id: "user-1" }, readiness: { status: "ready" } };
  }
  if (status === "anonymous") {
    return { status, methods: [] };
  }
  return { status };
}

function renderRoot(host: ProductHost) {
  return render(
    <ProductHostProvider host={host}>
      <DesktopProductLifecycleRoot />
    </ProductHostProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMocks.bootstrapHarnessRuntime.mockResolvedValue(undefined);
  setEntries({});
  useHarnessConnectionStore.getState().resetConnectionState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DesktopProductLifecycleRoot", () => {
  it("does not bootstrap a local runtime when desktop is null", () => {
    renderRoot(makeHost(null, "authenticated"));
    expect(runtimeMocks.bootstrapHarnessRuntime).not.toHaveBeenCalled();
  });

  it("keeps one runtime bootstrap across a host snapshot replacement", () => {
    const bridge = makeBridge(vi.fn().mockResolvedValue(undefined));
    const { rerender } = renderRoot(makeHost(bridge, "authenticated"));

    expect(runtimeMocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.bootstrapHarnessRuntime.mock.calls[0]?.[0]).toBe(bridge.runtime);
    const signal = runtimeMocks.bootstrapHarnessRuntime.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    rerender(
      <ProductHostProvider host={makeHost(bridge, "authenticated")}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );
    expect(runtimeMocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1);

    rerender(
      <ProductHostProvider host={makeHost(null, "authenticated")}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );
    expect(signal.aborted).toBe(true);
  });

  it("clears the published local runtime when the Desktop capability is removed", () => {
    const bridge = makeBridge(vi.fn().mockResolvedValue(undefined));
    const { rerender } = renderRoot(makeHost(bridge, "authenticated"));
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://127.0.0.1:9999",
      connectionState: "healthy",
      error: null,
    });

    rerender(
      <ProductHostProvider host={makeHost(null, "authenticated")}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );

    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "",
      connectionState: "connecting",
      error: null,
    });
  });

  it("does not export or subscribe when desktop is null", () => {
    const subscribeSpy = vi.spyOn(useSessionDirectoryStore, "subscribe");
    renderRoot(makeHost(null));
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it("exports the initial busy count through the bridge", () => {
    setEntries({ a: { busy: true } });
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderRoot(makeHost(makeBridge(setRunningAgentCount)));

    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(setRunningAgentCount).toHaveBeenCalledWith(1);
  });

  it("wires Desktop product lifecycles only through the mounted bridge", () => {
    const setWorkspaceActivity = vi.fn().mockResolvedValue(undefined);
    const setZoom = vi.fn().mockResolvedValue(undefined);
    const bridge = makeBridge(vi.fn().mockResolvedValue(undefined), {
      setWorkspaceActivity,
      setZoom,
    });

    renderRoot(makeHost(bridge));

    expect(useWorkspaceActivityIndicator).toHaveBeenCalledWith(setWorkspaceActivity);
    expect(useDesktopZoomPreferenceLifecycle).toHaveBeenCalledWith(setZoom);
    expect(lifecycleMocks.useUpdateRestartWatcher).toHaveBeenCalledWith(bridge.updater);
    expect(lifecycleMocks.useDesktopWorkerEnrollment).toHaveBeenCalledWith(
      bridge.worker,
      "loading",
      null,
    );

    cleanup();
    vi.mocked(useWorkspaceActivityIndicator).mockClear();
    vi.mocked(useDesktopZoomPreferenceLifecycle).mockClear();
    lifecycleMocks.useUpdateRestartWatcher.mockClear();
    lifecycleMocks.useDesktopWorkerEnrollment.mockClear();
    renderRoot(makeHost(null));

    expect(useWorkspaceActivityIndicator).not.toHaveBeenCalled();
    expect(useDesktopZoomPreferenceLifecycle).not.toHaveBeenCalled();
    expect(lifecycleMocks.useUpdateRestartWatcher).not.toHaveBeenCalled();
    expect(lifecycleMocks.useDesktopWorkerEnrollment).not.toHaveBeenCalled();
  });

  it("exports only changed counts as sessions go busy and idle", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderRoot(makeHost(makeBridge(setRunningAgentCount)));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);

    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(1);

    // Unchanged busy count: no additional export.
    act(() => setEntries({ a: { busy: true }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(2);

    act(() => setEntries({ a: { busy: false }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);
    expect(setRunningAgentCount).toHaveBeenCalledTimes(3);
  });

  it("does not duplicate work when the host is replaced with the same bridge", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const unsubscribeMenuCommands = vi.fn();
    const subscribeMenuCommands = vi.fn(() => unsubscribeMenuCommands);
    const bridge = makeBridge(setRunningAgentCount, { subscribeMenuCommands });
    const { rerender } = renderRoot(makeHost(bridge));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(subscribeMenuCommands).toHaveBeenCalledTimes(1);

    // A brand-new host snapshot carrying the same stable bridge.
    rerender(
      <ProductHostProvider host={makeHost(bridge)}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(subscribeMenuCommands).toHaveBeenCalledTimes(1);

    // The single subscription is still live.
    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(2);
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(1);
  });

  it("cleans up the subscription when the bridge is removed", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const unsubscribeMenuCommands = vi.fn();
    const bridge = makeBridge(setRunningAgentCount, {
      subscribeMenuCommands: () => unsubscribeMenuCommands,
    });
    const { rerender } = renderRoot(makeHost(bridge));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    rerender(
      <ProductHostProvider host={makeHost(null)}>
        <DesktopProductLifecycleRoot />
      </ProductHostProvider>,
    );

    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(unsubscribeMenuCommands).toHaveBeenCalledTimes(1);
  });

  it("cleans up the subscription on unmount", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderRoot(makeHost(makeBridge(setRunningAgentCount)));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    unmount();
    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });
});
