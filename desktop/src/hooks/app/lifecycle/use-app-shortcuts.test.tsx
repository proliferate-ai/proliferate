// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "@/hooks/app/workflows/use-app-command-actions";
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

  it("steps appearance font sizes through the registered app shortcuts", () => {
    renderHook(() => useAppShortcuts(commandActions()));

    useUserPreferencesStore.setState({
      uiFontSizeId: "xsmall",
      readableCodeFontSizeId: "xsmall",
    });

    expect(runShortcutHandler("app.decrease-text-size", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().uiFontSizeId).toBe("xxsmall");
    expect(useUserPreferencesStore.getState().readableCodeFontSizeId).toBe("xxsmall");

    expect(runShortcutHandler("app.decrease-text-size", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().uiFontSizeId).toBe("xxsmall");
    expect(useUserPreferencesStore.getState().readableCodeFontSizeId).toBe("xxsmall");

    useUserPreferencesStore.setState({
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "large",
    });

    expect(runShortcutHandler("app.increase-text-size", { source: "keyboard" })).toBe(true);
    expect(useUserPreferencesStore.getState().uiFontSizeId).toBe("xxxlarge");
    expect(useUserPreferencesStore.getState().readableCodeFontSizeId).toBe("xlarge");
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
    goPlugins: action(),
    goAutomations: action(),
    openSupport: action(),
    addRepository: action(),
    newLocalWorkspace: action(),
    newWorktreeWorkspace: action(),
    newCloudWorkspace: action(),
  };
}
