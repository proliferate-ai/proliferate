// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";

const navigateMocks = vi.hoisted(() => ({
  navigateApp: vi.fn(),
}));

const harnessMocks = vi.hoisted(() => ({
  state: {
    pendingWorkspaceEntry: null as unknown,
    selectedLogicalWorkspaceId: null as string | null,
    selectedWorkspaceId: null as string | null,
    deselectWorkspacePreservingSessions: vi.fn(),
  },
}));

const selectionMocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(async () => undefined),
}));

const logicalWorkspaceMocks = vi.hoisted(() => ({
  logicalWorkspaces: [] as unknown[],
}));

const shellMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}));

const toastMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

const editorMocks = vi.hoisted(() => ({
  resetWorkspaceEditorState: vi.fn(),
}));

const workspaceUiMocks = vi.hoisted(() => ({
  markWorkspaceViewed: vi.fn(),
}));

const latencyMocks = vi.hoisted(() => ({
  failLatencyFlow: vi.fn(),
  startLatencyFlow: vi.fn(() => "flow-1"),
}));

vi.mock("#product/lib/workflows/app/app-navigate-handoff", () => ({
  navigateApp: navigateMocks.navigateApp,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: typeof harnessMocks.state) => unknown) =>
    selector(harnessMocks.state),
}));

vi.mock("#product/hooks/workspaces/derived/use-pending-workspace-entries", () => ({
  useAttendedPendingWorkspaceEntry: () => harnessMocks.state.pendingWorkspaceEntry,
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: selectionMocks.selectWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: logicalWorkspaceMocks.logicalWorkspaces,
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    links: { openExternal: shellMocks.openExternal },
  }),
}));

const webAppMocks = vi.hoisted(() => ({
  webApp: { available: true, baseUrl: "https://web.proliferate.com" } as {
    available: boolean;
    baseUrl: string | null;
  },
}));

vi.mock("#product/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => webAppMocks.webApp,
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof toastMocks.show }) => unknown) =>
    selector({ show: toastMocks.show }),
}));

vi.mock("#product/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: editorMocks.resetWorkspaceEditorState,
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  markWorkspaceViewed: workspaceUiMocks.markWorkspaceViewed,
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  failLatencyFlow: latencyMocks.failLatencyFlow,
  startLatencyFlow: latencyMocks.startLatencyFlow,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  harnessMocks.state.pendingWorkspaceEntry = null;
  harnessMocks.state.selectedLogicalWorkspaceId = null;
  harnessMocks.state.selectedWorkspaceId = null;
  logicalWorkspaceMocks.logicalWorkspaces = [];
  selectionMocks.selectWorkspace.mockResolvedValue(undefined);
  shellMocks.openExternal.mockResolvedValue(undefined);
  webAppMocks.webApp = { available: true, baseUrl: "https://web.proliferate.com" };
});

describe("useWorkspaceNavigationWorkflow", () => {
  it("leaves a selected workspace with slot-preserving deselection before top-level navigation", () => {
    harnessMocks.state.selectedWorkspaceId = "materialized-1";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(navigateMocks.navigateApp).toHaveBeenCalledWith("/");
  });

  it("deselects pending workspace state before top-level navigation", () => {
    harnessMocks.state.pendingWorkspaceEntry = { id: "pending-1" };
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(navigateMocks.navigateApp).toHaveBeenCalledWith("/");
  });

  it("deselects logical-only workspace state before top-level navigation", () => {
    harnessMocks.state.selectedLogicalWorkspaceId = "logical-1";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(navigateMocks.navigateApp).toHaveBeenCalledWith("/");
  });

  it("selects workspaces through the shared latency and viewed-state workflow", () => {
    window.history.replaceState(null, "", "/settings");
    harnessMocks.state.selectedLogicalWorkspaceId = "logical-current";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.selectWorkspaceFromSurface("logical-current", "shortcut"));

    expect(navigateMocks.navigateApp).toHaveBeenCalledWith("/");
    expect(workspaceUiMocks.markWorkspaceViewed).toHaveBeenCalledWith("logical-current");
    expect(latencyMocks.startLatencyFlow).toHaveBeenCalledWith({
      flowKind: "workspace_switch",
      source: "shortcut",
      targetWorkspaceId: "logical-current",
    });
    expect(selectionMocks.selectWorkspace).toHaveBeenCalledWith("logical-current", {
      latencyFlowId: "flow-1",
      knownWorkspace: null,
    });
  });

  it("selects stale unclaimed cloud entries in-desktop (the web handoff died with the cloud stack)", () => {
    logicalWorkspaceMocks.logicalWorkspaces = [{
      id: "logical-unclaimed",
      localWorkspace: null,
      mobilityWorkspace: null,
      cloudWorkspace: {
        id: "cloud-unclaimed-1",
        visibility: "shared_unclaimed",
      },
    }];
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.selectWorkspaceFromSurface("logical-unclaimed", "sidebar"));

    expect(shellMocks.openExternal).not.toHaveBeenCalled();
    expect(selectionMocks.selectWorkspace).toHaveBeenCalledWith("logical-unclaimed", {
      latencyFlowId: "flow-1",
      knownWorkspace: null,
    });
  });
});
