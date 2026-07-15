// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "@/hooks/app/workflows/app-command-action-types";
import { useAppShortcuts } from "@/hooks/app/lifecycle/use-app-shortcuts";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { requestRightPanelTabByIndex } from "@/lib/workflows/workspaces/right-panel-shortcut-requests";

const navigationMocks = vi.hoisted(() => ({
  selectWorkspaceFromSurface: vi.fn(),
}));

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: null as string | null,
  selectedLogicalWorkspaceId: null as string | null,
  sidebarShortcutTargets: [] as string[],
}));

vi.mock("@/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => harnessState.sidebarShortcutTargets,
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: navigationMocks.selectWorkspaceFromSurface,
  }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: {
      selectedWorkspaceId: string | null;
      selectedLogicalWorkspaceId: string | null;
    }) => unknown,
  ) =>
    selector({
      selectedWorkspaceId: harnessState.selectedWorkspaceId,
      selectedLogicalWorkspaceId: harnessState.selectedLogicalWorkspaceId,
    }),
}));

vi.mock("@/lib/workflows/workspaces/right-panel-shortcut-requests", () => ({
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
    vi.clearAllMocks();
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
});

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
    newCloudWorkspace: action(),
    copyWorkspacePath: action(),
    copyBranchName: action(),
  };
}
