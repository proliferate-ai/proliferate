/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMainScreenState } from "#product/hooks/main/facade/use-main-screen-state";
import { WORKSPACE_SIDEBAR_DEFAULT_WIDTH } from "#product/lib/domain/preferences/workspace-ui/sidebar";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const rightPanelState = vi.hoisted(() => ({
  rightPanelState: { activeTab: "files" as const },
  setRightPanelState: vi.fn(),
  rightPanelOpen: false,
  setRightPanelOpen: vi.fn(),
  rightPanelWidth: 360,
  setRightPanelWidth: vi.fn(),
  rightPanelResizing: false,
  rightPanelFocusRequestToken: 0,
  requestRightPanelFocus: vi.fn(),
  onRightSeparatorDown: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useCurrentPullRequestQuery: () => ({ data: undefined }),
  useGitStatusQuery: () => ({ data: undefined }),
}));

vi.mock("#product/hooks/main/facade/use-main-screen-right-panel", () => ({
  useMainScreenRightPanel: () => rightPanelState,
}));

vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ state: null }),
}));

vi.mock("#product/hooks/workspaces/derived/use-hot-paint-gate", () => ({
  useIsHotPaintGatePendingForWorkspace: () => false,
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: { workspaces: [], repoRoots: [], cloudWorkspaces: [] } }),
}));

vi.mock("#product/stores/chat/chat-launch-intent-store", () => ({
  useChatLaunchIntentStore: (selector: (state: { activeIntent: null }) => unknown) =>
    selector({ activeIntent: null }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: {
    pendingWorkspaceEntry: null;
    selectedWorkspaceId: null;
    selectedLogicalWorkspaceId: null;
  }) => unknown) => selector({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
    selectedLogicalWorkspaceId: null,
  }),
}));

function mouseDownEvent(clientX: number): ReactMouseEvent {
  return {
    clientX,
    clientY: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactMouseEvent;
}

describe("useMainScreenState sidebar drag", () => {
  beforeEach(() => {
    useWorkspaceUiStore.setState({
      sidebarOpen: true,
      sidebarWidth: WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps live mousemoves transient and commits the final width once on release", () => {
    const durableWidths: number[] = [];
    const unsubscribe = useWorkspaceUiStore.subscribe((state, previous) => {
      if (state.sidebarWidth !== previous.sidebarWidth) {
        durableWidths.push(state.sidebarWidth);
      }
    });
    const { result } = renderHook(() => useMainScreenState());

    act(() => {
      result.current.layout.onLeftSeparatorDown(mouseDownEvent(100));
    });
    act(() => {
      for (let clientX = 101; clientX <= 200; clientX += 1) {
        document.dispatchEvent(new MouseEvent("mousemove", { clientX }));
      }
    });

    expect(result.current.layout.sidebarWidth).toBe(375);
    expect(result.current.layout.sidebarResizing).toBe(true);
    expect(durableWidths).toHaveLength(0);
    expect(useWorkspaceUiStore.getState().sidebarWidth)
      .toBe(WORKSPACE_SIDEBAR_DEFAULT_WIDTH);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(useWorkspaceUiStore.getState().sidebarWidth).toBe(375);
    expect(result.current.layout.sidebarResizing).toBe(false);
    expect(durableWidths).toEqual([375]);
    unsubscribe();
  });

  it("does not commit when a separator press ends without movement", () => {
    const durableWidths: number[] = [];
    const unsubscribe = useWorkspaceUiStore.subscribe((state, previous) => {
      if (state.sidebarWidth !== previous.sidebarWidth) {
        durableWidths.push(state.sidebarWidth);
      }
    });
    const { result } = renderHook(() => useMainScreenState());

    act(() => {
      result.current.layout.onLeftSeparatorDown(mouseDownEvent(100));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(useWorkspaceUiStore.getState().sidebarWidth)
      .toBe(WORKSPACE_SIDEBAR_DEFAULT_WIDTH);
    expect(durableWidths).toEqual([]);
    unsubscribe();
  });

  it("commits the latest live width when the owning surface unmounts mid-drag", () => {
    const durableWidths: number[] = [];
    const unsubscribe = useWorkspaceUiStore.subscribe((state, previous) => {
      if (state.sidebarWidth !== previous.sidebarWidth) {
        durableWidths.push(state.sidebarWidth);
      }
    });
    const { result, unmount } = renderHook(() => useMainScreenState());

    act(() => {
      result.current.layout.onLeftSeparatorDown(mouseDownEvent(100));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 }));
    });
    expect(result.current.layout.sidebarWidth).toBe(325);
    expect(durableWidths).toEqual([]);

    act(() => unmount());

    expect(useWorkspaceUiStore.getState().sidebarWidth).toBe(325);
    expect(durableWidths).toEqual([325]);
    unsubscribe();
  });
});
