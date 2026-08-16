// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { useAppShortcuts } from "#product/hooks/app/lifecycle/use-app-shortcuts";
import { useShortcutDispatcher } from "#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";
import { USER_PREFERENCE_DEFAULTS } from "#product/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { requestRightPanelTabByIndex } from "#product/lib/workflows/workspaces/right-panel-shortcut-requests";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";
import { WORKSPACE_CURSOR_SETTLE_MS } from "#product/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller";

const navigationMocks = vi.hoisted(() => ({
  selectWorkspaceFromSurface: vi.fn(),
}));

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: null as string | null,
  selectedLogicalWorkspaceId: null as string | null,
  sidebarShortcutTargets: [] as string[],
}));

vi.mock("#product/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => harnessState.sidebarShortcutTargets,
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

describe("useAppShortcuts", () => {
  beforeEach(() => {
    harnessState.selectedWorkspaceId = null;
    harnessState.selectedLogicalWorkspaceId = null;
    harnessState.sidebarShortcutTargets = [];
    clearShortcutHandlerRegistryForTests();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: true,
      _persistedMetadata: {},
    });
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    document.body.innerHTML = "";
    useSidebarSwitchCursorStore.getState().setCursor(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("held-key workspace traversal", () => {
    it("previews the cursor on a step and commits the selection once after the settle", () => {
      harnessState.selectedWorkspaceId = "workspace-1";
      harnessState.selectedLogicalWorkspaceId = "workspace-1";
      harnessState.sidebarShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
      vi.useFakeTimers();

      renderHook(() => useAppShortcuts(commandActions()));

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
      harnessState.sidebarShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
      vi.useFakeTimers();

      renderHook(() => useAppShortcuts(commandActions()));

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

  it("steps window zoom through the registered app shortcuts without changing font sizes", () => {
    renderHook(() => useAppShortcuts(commandActions()));

    useUserPreferencesStore.setState({
      windowZoomId: "zoom90",
      uiFontSizeId: "xsmall",
      readableCodeFontSizeId: "xsmall",
    });

    expect(runShortcutHandler("app.decrease-window-zoom", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().windowZoomId).toBe("zoom80");
    expect(useUserPreferencesStore.getState().uiFontSizeId).toBe("xsmall");
    expect(useUserPreferencesStore.getState().readableCodeFontSizeId).toBe("xsmall");

    expect(runShortcutHandler("app.decrease-window-zoom", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().windowZoomId).toBe("zoom80");

    useUserPreferencesStore.setState({
      windowZoomId: "zoom110",
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "large",
    });

    expect(runShortcutHandler("app.increase-window-zoom", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().windowZoomId).toBe("zoom120");
    expect(useUserPreferencesStore.getState().uiFontSizeId).toBe("xxxlarge");
    expect(useUserPreferencesStore.getState().readableCodeFontSizeId).toBe("large");
  });

  it("routes option-number shortcuts to the right panel when right-panel focus is active", () => {
    harnessState.selectedWorkspaceId = "workspace-1";
    harnessState.selectedLogicalWorkspaceId = "workspace-1";
    harnessState.sidebarShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();

    renderHook(() => useAppShortcuts(commandActions()));

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
    harnessState.sidebarShortcutTargets = ["workspace-1", "workspace-2", "workspace-3"];
    const zone = document.createElement("div");
    zone.tabIndex = 0;
    zone.setAttribute("data-focus-zone", "right-panel");
    document.body.append(zone);
    zone.focus();
    vi.mocked(requestRightPanelTabByIndex).mockReturnValueOnce(false);

    renderHook(() => useAppShortcuts(commandActions()));

    expect(runShortcutHandler("workspace.by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(requestRightPanelTabByIndex).toHaveBeenCalledWith(2);
    expect(navigationMocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "workspace-2",
      "shortcut",
    );
  });

  it("routes workspace copy shortcuts through app command actions", () => {
    const actions = commandActions();
    renderHook(() => useAppShortcuts(actions));

    expect(runShortcutHandler("workspace.copy-path", { source: "keyboard" })).toBe(true);
    expect(actions.copyWorkspacePath.execute).toHaveBeenCalledWith("shortcut");

    expect(runShortcutHandler("workspace.copy-branch", { source: "keyboard" })).toBe(true);
    expect(actions.copyBranchName.execute).toHaveBeenCalledWith("shortcut");
  });

  it("routes the broad web shortcut through app command actions", () => {
    const actions = commandActions();
    renderHook(() => useAppShortcuts(actions));

    expect(runShortcutHandler("app.open-web", { source: "keyboard" })).toBe(true);
    expect(actions.openWebApp.execute).toHaveBeenCalledWith("shortcut");
  });

  it("prioritizes a child Cowork owner across unmount and remount regardless of effect order", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });
    const actions = commandActions();
    const createCoworkThread = vi.fn();
    const { rerender } = render(
      <GlobalShortcutOwner actions={actions}>
        <ContextualCoworkShortcutOwner onCreateThread={createCoworkThread} />
      </GlobalShortcutOwner>,
    );

    expect(dispatchNewChatKeyboardShortcut().defaultPrevented).toBe(true);
    expect(createCoworkThread).toHaveBeenCalledTimes(1);
    expect(actions.goHome.execute).not.toHaveBeenCalled();
    expect(actions.newLocalWorkspace.execute).not.toHaveBeenCalled();
    expect(actions.newWorktreeWorkspace.execute).not.toHaveBeenCalled();

    rerender(<GlobalShortcutOwner actions={actions} />);
    expect(dispatchNewChatKeyboardShortcut().defaultPrevented).toBe(true);
    expect(createCoworkThread).toHaveBeenCalledTimes(1);
    expect(actions.goHome.execute).toHaveBeenCalledTimes(1);
    expect(actions.newWorktreeWorkspace.execute).not.toHaveBeenCalled();

    rerender(
      <GlobalShortcutOwner actions={actions}>
        <ContextualCoworkShortcutOwner onCreateThread={createCoworkThread} />
      </GlobalShortcutOwner>,
    );
    expect(dispatchNewChatKeyboardShortcut().defaultPrevented).toBe(true);
    expect(createCoworkThread).toHaveBeenCalledTimes(2);
    expect(actions.goHome.execute).toHaveBeenCalledTimes(1);
  });

  it("opens New Chat and focuses its composer outside Cowork", () => {
    vi.useFakeTimers();
    const actions = commandActions();
    const chatZone = document.createElement("div");
    chatZone.setAttribute("data-focus-zone", "chat");
    const composer = document.createElement("textarea");
    chatZone.append(composer);
    document.body.append(chatZone);
    renderHook(() => useAppShortcuts(actions));

    expect(runShortcutHandler("workspace.new-default", { source: "keyboard" })).toBe(true);
    expect(actions.goHome.execute).toHaveBeenCalledWith("shortcut");
    expect(actions.newWorktreeWorkspace.execute).not.toHaveBeenCalled();
    expect(actions.newLocalWorkspace.execute).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(composer);
  });

  it("keeps the explicit local and worktree creation shortcuts", () => {
    const actions = commandActions();
    renderHook(() => useAppShortcuts(actions));

    expect(runShortcutHandler("workspace.new-local", { source: "keyboard" })).toBe(true);
    expect(runShortcutHandler("workspace.new-worktree", { source: "keyboard" })).toBe(true);

    expect(actions.newLocalWorkspace.execute).toHaveBeenCalledWith("shortcut");
    expect(actions.newWorktreeWorkspace.execute).toHaveBeenCalledWith("shortcut");
  });

  describe("app.open-support gating", () => {
    // Mirrors the sidebar/palette hiding the support action under
    // `support.kind === "none"` (`SidebarHelpSection`): Cmd+S must not just
    // no-op, the shortcut must not be registered at all.
    it("routes Cmd+S through app command actions when the action is visible", () => {
      const actions = commandActions();
      renderHook(() => useAppShortcuts(actions));

      expect(runShortcutHandler("app.open-support", { source: "keyboard" })).toBe(true);
      expect(actions.openSupport.execute).toHaveBeenCalledWith("shortcut");
    });

    it("leaves Cmd+S unregistered (inert) when the action is hidden", () => {
      const actions = commandActions();
      actions.openSupport = { ...actions.openSupport, hidden: true };
      renderHook(() => useAppShortcuts(actions));

      expect(runShortcutHandler("app.open-support", { source: "keyboard" })).toBe(false);
      expect(actions.openSupport.execute).not.toHaveBeenCalled();
    });
  });

  describe("app.go-automations gating", () => {
    // The workflows_v2 gate hides the action, and a hidden action must leave
    // its shortcut unregistered rather than routing to the dark surface.
    it("routes the shortcut through app command actions when the action is visible", () => {
      const actions = commandActions();
      renderHook(() => useAppShortcuts(actions));

      expect(runShortcutHandler("app.go-automations", { source: "keyboard" })).toBe(true);
      expect(actions.goWorkflows.execute).toHaveBeenCalledWith("shortcut");
    });

    it("leaves the shortcut unregistered (inert) when the action is hidden", () => {
      const actions = commandActions();
      actions.goWorkflows = { ...actions.goWorkflows, hidden: true };
      renderHook(() => useAppShortcuts(actions));

      expect(runShortcutHandler("app.go-automations", { source: "keyboard" })).toBe(false);
      expect(actions.goWorkflows.execute).not.toHaveBeenCalled();
    });
  });
});

function GlobalShortcutOwner({
  actions,
  children,
}: {
  actions: AppCommandActions;
  children?: ReactNode;
}) {
  useAppShortcuts(actions);
  useShortcutDispatcher();
  return children;
}

function ContextualCoworkShortcutOwner({
  onCreateThread,
}: {
  onCreateThread: () => void;
}) {
  useShortcutHandler("workspace.new-default", onCreateThread, {
    priority: "contextual",
  });
  return null;
}

function dispatchNewChatKeyboardShortcut(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "n",
    code: "KeyN",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function commandActions(): AppCommandActions {
  const action = () => ({
    disabledReason: null,
    execute: vi.fn(),
  });
  return {
    openSettings: action(),
    showKeyboardShortcuts: action(),
    goHome: action(),
    goWorkflows: action(),
    openWebApp: action(),
    openSupport: action(),
    addRepository: action(),
    newLocalWorkspace: action(),
    newWorktreeWorkspace: action(),
    copyWorkspacePath: action(),
    copyBranchName: action(),
  };
}
