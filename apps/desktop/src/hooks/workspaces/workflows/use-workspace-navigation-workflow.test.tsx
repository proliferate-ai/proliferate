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

vi.mock("@/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: selectionMocks.selectWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-logical-workspaces", () => ({
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

vi.mock("@/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => webAppMocks.webApp,
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

  it("selects workspaces through the shared latency and viewed-state workflow", () => {
    routerMocks.location.pathname = "/settings";
    harnessMocks.state.selectedLogicalWorkspaceId = "logical-current";
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
      "https://web.proliferate.com/cloud/workspaces/cloud-unclaimed-1",
    );
    expect(selectionMocks.selectWorkspace).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("falls through to normal in-desktop selection when this deployment has no web app", () => {
    webAppMocks.webApp = { available: false, baseUrl: null };
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

    // No dead vendor-web link when the deployment has no web app: normal
    // desktop workspace selection runs instead.
    expect(shellMocks.openExternal).not.toHaveBeenCalled();
    expect(selectionMocks.selectWorkspace).toHaveBeenCalledWith("logical-unclaimed", {
      latencyFlowId: "flow-1",
    });
  });
});
