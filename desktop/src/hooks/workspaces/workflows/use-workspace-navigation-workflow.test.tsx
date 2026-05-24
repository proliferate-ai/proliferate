// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/" },
}));

const harnessMocks = vi.hoisted(() => ({
  state: {
    pendingWorkspaceEntry: null as unknown,
    selectedLogicalWorkspaceId: null as string | null,
    selectedWorkspaceId: null as string | null,
    deselectWorkspacePreservingSessions: vi.fn(),
  },
}));

const mobilityMocks = vi.hoisted(() => ({
  state: {
    selectionLocked: false,
    selectedLogicalWorkspaceId: null as string | null,
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

vi.mock("react-router-dom", () => ({
  useLocation: () => routerMocks.location,
  useNavigate: () => routerMocks.navigate,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: typeof harnessMocks.state) => unknown) =>
    selector(harnessMocks.state),
}));

vi.mock("@/hooks/workspaces/mobility/use-workspace-mobility-state", () => ({
  useWorkspaceMobilityState: () => mobilityMocks.state,
}));

vi.mock("@/hooks/workspaces/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: selectionMocks.selectWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: logicalWorkspaceMocks.logicalWorkspaces,
  }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    openExternal: shellMocks.openExternal,
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof toastMocks.show }) => unknown) =>
    selector({ show: toastMocks.show }),
}));

vi.mock("@/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: editorMocks.resetWorkspaceEditorState,
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  markWorkspaceViewed: workspaceUiMocks.markWorkspaceViewed,
}));

vi.mock("@/lib/infra/measurement/latency-flow", () => ({
  failLatencyFlow: latencyMocks.failLatencyFlow,
  startLatencyFlow: latencyMocks.startLatencyFlow,
}));

beforeEach(() => {
  vi.clearAllMocks();
  routerMocks.location.pathname = "/";
  harnessMocks.state.pendingWorkspaceEntry = null;
  harnessMocks.state.selectedLogicalWorkspaceId = null;
  harnessMocks.state.selectedWorkspaceId = null;
  mobilityMocks.state.selectionLocked = false;
  mobilityMocks.state.selectedLogicalWorkspaceId = null;
  logicalWorkspaceMocks.logicalWorkspaces = [];
  selectionMocks.selectWorkspace.mockResolvedValue(undefined);
  shellMocks.openExternal.mockResolvedValue(undefined);
});

describe("useWorkspaceNavigationWorkflow", () => {
  it("leaves a selected workspace with slot-preserving deselection before top-level navigation", () => {
    harnessMocks.state.selectedWorkspaceId = "materialized-1";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
  });

  it("deselects pending workspace state before top-level navigation", () => {
    harnessMocks.state.pendingWorkspaceEntry = { id: "pending-1" };
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
  });

  it("deselects logical-only workspace state before top-level navigation", () => {
    harnessMocks.state.selectedLogicalWorkspaceId = "logical-1";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(harnessMocks.state.deselectWorkspacePreservingSessions).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetWorkspaceEditorState).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
  });

  it("blocks top-level navigation while workspace mobility locks selection", () => {
    mobilityMocks.state.selectionLocked = true;
    harnessMocks.state.selectedWorkspaceId = "materialized-1";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.goToTopLevelRoute("/"));

    expect(toastMocks.show).toHaveBeenCalledWith(
      "Finish the current workspace move before leaving this workspace.",
    );
    expect(harnessMocks.state.deselectWorkspacePreservingSessions).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("blocks workspace switching while mobility is locked to another logical workspace", () => {
    mobilityMocks.state.selectionLocked = true;
    mobilityMocks.state.selectedLogicalWorkspaceId = "logical-current";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.selectWorkspaceFromSurface("logical-target", "shortcut"));

    expect(toastMocks.show).toHaveBeenCalledWith(
      "Finish the current workspace move before switching workspaces.",
    );
    expect(selectionMocks.selectWorkspace).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("selects workspaces through the shared latency and viewed-state workflow", () => {
    routerMocks.location.pathname = "/settings";
    mobilityMocks.state.selectedLogicalWorkspaceId = "logical-current";
    const { result } = renderHook(() => useWorkspaceNavigationWorkflow());

    act(() => result.current.selectWorkspaceFromSurface("logical-current", "shortcut"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/");
    expect(workspaceUiMocks.markWorkspaceViewed).toHaveBeenCalledWith("logical-current");
    expect(latencyMocks.startLatencyFlow).toHaveBeenCalledWith({
      flowKind: "workspace_switch",
      source: "shortcut",
      targetWorkspaceId: "logical-current",
    });
    expect(selectionMocks.selectWorkspace).toHaveBeenCalledWith("logical-current", {
      latencyFlowId: "flow-1",
    });
  });

  it("opens shared unclaimed cloud workspaces in the web app instead of selecting them in desktop", () => {
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

    expect(shellMocks.openExternal).toHaveBeenCalledWith(
      "https://app.proliferate.ai/cloud/workspaces/cloud-unclaimed-1",
    );
    expect(selectionMocks.selectWorkspace).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });
});
