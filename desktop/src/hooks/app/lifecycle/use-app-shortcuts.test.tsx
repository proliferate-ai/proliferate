// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "@/hooks/app/workflows/use-app-command-actions";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useAppShortcuts } from "./use-app-shortcuts";

vi.mock("@/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => [],
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: vi.fn(),
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
      selectedWorkspaceId: null,
      selectedLogicalWorkspaceId: null,
    }),
}));

function buildCommandActions(): AppCommandActions {
  const action = {
    execute: vi.fn(),
    disabledReason: null,
  };

  return {
    openSettings: action,
    showKeyboardShortcuts: action,
    goHome: action,
    goPlugins: action,
    goAutomations: action,
    openSupport: action,
    addRepository: action,
    newLocalWorkspace: action,
    newWorktreeWorkspace: action,
    newCloudWorkspace: action,
  };
}

describe("useAppShortcuts", () => {
  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("steps appearance font sizes through the registered app shortcuts", () => {
    renderHook(() => useAppShortcuts(buildCommandActions()));

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
});
