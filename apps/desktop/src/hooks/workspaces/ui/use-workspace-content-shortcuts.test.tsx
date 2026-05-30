// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useContentSearchStore } from "@/stores/search/content-search-store";
import {
  requestRightPanelCloseActiveTab,
  requestRightPanelRelativeTab,
  requestRightPanelTabByIndex,
} from "@/lib/workflows/workspaces/right-panel-shortcut-requests";

function createActions(overrides: Partial<{
  activateRelativeTab: ReturnType<typeof vi.fn>;
  activateTabByShortcutIndex: ReturnType<typeof vi.fn>;
  closeActiveWorkspaceTab: ReturnType<typeof vi.fn>;
  openNewSessionTab: ReturnType<typeof vi.fn>;
  restoreLastDismissedTab: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    activateRelativeTab: vi.fn(() => true),
    activateTabByShortcutIndex: vi.fn(),
    closeActiveWorkspaceTab: vi.fn(() => "closed" as const),
    openNewSessionTab: vi.fn(() => true),
    restoreLastDismissedTab: vi.fn(),
    ...overrides,
  };
}

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: "workspace-1" as string | null,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector(harnessState),
}));

vi.mock("@/lib/workflows/workspaces/right-panel-shortcut-requests", () => ({
  requestRightPanelCloseActiveTab: vi.fn(() => true),
  requestRightPanelRelativeTab: vi.fn(() => true),
  requestRightPanelTabByIndex: vi.fn(() => true),
}));

describe("useWorkspaceContentShortcuts", () => {
  beforeEach(() => {
    harnessState.selectedWorkspaceId = "workspace-1";
    clearShortcutHandlerRegistryForTests();
    useContentSearchStore.setState({
      open: false,
      query: "",
      surface: "chat",
      scope: "diffs",
      activeMatchIndex: 0,
      activeMatchId: null,
      unitsById: {},
      nextUnitOrder: 0,
    });
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("uses Cmd+T for a new chat tab", () => {
    const actions = createActions();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(actions.openNewSessionTab).not.toHaveBeenCalled();

    expect(runShortcutHandler("workspace.new-session-tab", { source: "keyboard" })).toBe(true);
    expect(actions.openNewSessionTab).toHaveBeenCalledTimes(1);
  });

  it("keeps shell tab shortcuts registered even before the global workspace selection store settles", () => {
    harnessState.selectedWorkspaceId = null;
    const actions = createActions();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.close-active-tab", { source: "menu" })).toBe(true);
    expect(actions.closeActiveWorkspaceTab).toHaveBeenCalledTimes(1);
  });

  it("routes close-tab shortcuts to the right panel when focus is in the right panel", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.close-active-tab", { source: "keyboard" })).toBe(true);
    expect(requestRightPanelCloseActiveTab).toHaveBeenCalledTimes(1);
    expect(actions.closeActiveWorkspaceTab).not.toHaveBeenCalled();
  });

  it("falls back to workspace tab close when a stale right-panel close request is unhandled", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();
    vi.mocked(requestRightPanelCloseActiveTab).mockReturnValueOnce(false);

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.close-active-tab", { source: "keyboard" })).toBe(true);
    expect(requestRightPanelCloseActiveTab).toHaveBeenCalledTimes(1);
    expect(actions.closeActiveWorkspaceTab).toHaveBeenCalledTimes(1);
  });

  it("routes tab cycling to the right panel when focus is in the right panel", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.next-tab", { source: "keyboard" })).toBe(true);
    expect(requestRightPanelRelativeTab).toHaveBeenCalledWith(1);
    expect(actions.activateRelativeTab).not.toHaveBeenCalled();
  });

  it("falls back to workspace tab cycling when a stale right-panel focus request is unhandled", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();
    vi.mocked(requestRightPanelRelativeTab).mockReturnValueOnce(false);

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.next-tab", { source: "keyboard" })).toBe(true);
    expect(requestRightPanelRelativeTab).toHaveBeenCalledWith(1);
    expect(actions.activateRelativeTab).toHaveBeenCalledWith(1);
  });

  it("routes chat-tab number shortcuts to the right panel when focus is in the right panel", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.tab-by-index", {
      source: "keyboard",
      digit: 3,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).toHaveBeenCalledWith(3);
    expect(actions.activateTabByShortcutIndex).not.toHaveBeenCalled();
  });

  it("falls back to chat-tab number shortcuts when a stale right-panel focus request is unhandled", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();
    vi.mocked(requestRightPanelTabByIndex).mockReturnValueOnce(false);

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.tab-by-index", {
      source: "keyboard",
      digit: 3,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).toHaveBeenCalledWith(3);
    expect(actions.activateTabByShortcutIndex).toHaveBeenCalledWith("3");
  });

  it("keeps chat-tab number shortcuts in chat when chat owns focus", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "chat");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.tab-by-index", {
      source: "keyboard",
      digit: 3,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).not.toHaveBeenCalled();
    expect(actions.activateTabByShortcutIndex).toHaveBeenCalledWith("3");
  });

  it("opens chat content search when chat owns focus", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "chat");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.find-content", { source: "keyboard" })).toBe(true);
    expect(useContentSearchStore.getState().open).toBe(true);
    expect(useContentSearchStore.getState().surface).toBe("chat");
    expect(useContentSearchStore.getState().scope).toBe("diffs");
  });

  it("routes content search to the file viewer when file viewer owns focus", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    const frame = document.createElement("div");
    frame.setAttribute("data-file-viewer-frame", "true");
    const focusTarget = document.createElement("button");
    frame.append(focusTarget);
    zone.append(frame);
    document.body.append(zone);
    focusTarget.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.find-content", { source: "keyboard" })).toBe(true);
    expect(useContentSearchStore.getState().open).toBe(true);
    expect(useContentSearchStore.getState().surface).toBe("file");
    expect(useContentSearchStore.getState().scope).toBe("diffs");
  });

  it("declines content search when terminal or browser owns focus", () => {
    const actions = createActions();
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "terminal");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(runShortcutHandler("workspace.find-content", { source: "keyboard" })).toBe(false);
    expect(useContentSearchStore.getState().open).toBe(false);
  });
});
