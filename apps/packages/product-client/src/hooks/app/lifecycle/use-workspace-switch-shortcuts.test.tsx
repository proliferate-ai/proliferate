// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSwitchShortcuts } from "#product/hooks/app/lifecycle/use-workspace-switch-shortcuts";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";
import { requestRightPanelTabByIndex } from "#product/lib/workflows/workspaces/right-panel-shortcut-requests";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";
import { WORKSPACE_CURSOR_SETTLE_MS } from "#product/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller";

const navigationMocks = vi.hoisted(() => ({
  selectWorkspaceFromSurface: vi.fn(),
}));

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: null as string | null,
  selectedLogicalWorkspaceId: null as string | null,
  digitShortcutTargets: [] as string[],
  traversalShortcutTargets: [] as string[],
}));

vi.mock("#product/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => ({
    digitTargetIds: harnessState.digitShortcutTargets,
    traversalTargetIds: harnessState.traversalShortcutTargets,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: navigationMocks.selectWorkspaceFromSurface,
  }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => {
  const readSelection = () => ({
    selectedWorkspaceId: harnessState.selectedWorkspaceId,
    selectedLogicalWorkspaceId: harnessState.selectedLogicalWorkspaceId,
  });
  const useSessionSelectionStore = (
    selector: (state: {
      selectedWorkspaceId: string | null;
      selectedLogicalWorkspaceId: string | null;
    }) => unknown,
  ) => selector(readSelection());
  // The traversal-cursor effect reads the committed selection imperatively and
  // subscribes for commit reflection, so the mock exposes the same static
  // surface the real zustand store does.
  useSessionSelectionStore.getState = readSelection;
  useSessionSelectionStore.subscribe = () => () => {};
  return { useSessionSelectionStore };
});

vi.mock("#product/lib/workflows/workspaces/right-panel-shortcut-requests", () => ({
  requestRightPanelTabByIndex: vi.fn(() => true),
}));

describe("useWorkspaceSwitchShortcuts", () => {
  beforeEach(() => {
    harnessState.selectedWorkspaceId = null;
    harnessState.selectedLogicalWorkspaceId = null;
    harnessState.digitShortcutTargets = [];
    harnessState.traversalShortcutTargets = [];
    clearShortcutHandlerRegistryForTests();
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    document.body.innerHTML = "";
    useSidebarSwitchCursorStore.getState().setCursor(null);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("held-key workspace traversal", () => {
    it("previews the cursor on a step and commits the selection once after the settle", () => {
      harnessState.selectedWorkspaceId = "workspace-1";
      harnessState.selectedLogicalWorkspaceId = "workspace-1";
      harnessState.digitShortcutTargets = ["pinned-workspace"];
      harnessState.traversalShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
      vi.useFakeTimers();

      renderHook(() => useWorkspaceSwitchShortcuts());

      expect(runShortcutHandler("workspace.next-workspace", { source: "keyboard" })).toBe(true);
      // The step previews immediately via the cursor, without committing.
      expect(useSidebarSwitchCursorStore.getState().cursorId).toBe("workspace-2");
      expect(navigationMocks.selectWorkspaceFromSurface).not.toHaveBeenCalled();

      // The one expensive selection commit fires only after movement settles.
      act(() => {
        vi.advanceTimersByTime(WORKSPACE_CURSOR_SETTLE_MS);
      });
      expect(navigationMocks.selectWorkspaceFromSurface).toHaveBeenCalledTimes(1);
      expect(navigationMocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
        "workspace-2",
        "shortcut",
      );
    });

    it("cancels an uncommitted preview on Escape without committing", () => {
      harnessState.selectedWorkspaceId = "workspace-1";
      harnessState.selectedLogicalWorkspaceId = "workspace-1";
      harnessState.traversalShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
      vi.useFakeTimers();

      renderHook(() => useWorkspaceSwitchShortcuts());

      runShortcutHandler("workspace.next-workspace", { source: "keyboard" });
      expect(useSidebarSwitchCursorStore.getState().cursorId).toBe("workspace-2");

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(useSidebarSwitchCursorStore.getState().cursorId).toBeNull();

      act(() => {
        vi.advanceTimersByTime(WORKSPACE_CURSOR_SETTLE_MS);
      });
      expect(navigationMocks.selectWorkspaceFromSurface).not.toHaveBeenCalled();
    });
  });

  it("routes option-number shortcuts to the right panel when right-panel focus is active", () => {
    harnessState.selectedWorkspaceId = "workspace-1";
    harnessState.selectedLogicalWorkspaceId = "workspace-1";
    harnessState.digitShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useWorkspaceSwitchShortcuts());

    expect(runShortcutHandler("workspace.by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).toHaveBeenCalledWith(2);
    expect(navigationMocks.selectWorkspaceFromSurface).not.toHaveBeenCalled();
  });

  it("falls back to workspace selection when a stale right-panel focus request is unhandled", () => {
    harnessState.selectedWorkspaceId = "workspace-1";
    harnessState.selectedLogicalWorkspaceId = "workspace-1";
    harnessState.digitShortcutTargets = ["pin-1", "pin-2", "workspace-1"];
    harnessState.traversalShortcutTargets = ["workspace-1", "pin-1", "pin-2"];
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();
    vi.mocked(requestRightPanelTabByIndex).mockReturnValueOnce(false);

    renderHook(() => useWorkspaceSwitchShortcuts());

    expect(runShortcutHandler("workspace.by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).toHaveBeenCalledWith(2);
    expect(navigationMocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "pin-2",
      "shortcut",
    );
  });
});
