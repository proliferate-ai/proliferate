// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { requestRightPanelBrowserTab } from "@/lib/infra/right-panel-new-tab-menu";

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: "workspace-1" as string | null,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector(harnessState),
}));

vi.mock("@/lib/infra/right-panel-new-tab-menu", () => ({
  requestRightPanelBrowserTab: vi.fn(() => true),
}));

describe("useWorkspaceContentShortcuts", () => {
  beforeEach(() => {
    harnessState.selectedWorkspaceId = "workspace-1";
    clearShortcutHandlerRegistryForTests();
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.clearAllMocks();
  });

  it("uses Cmd+T for browser tabs without registering a new-chat shortcut", () => {
    const actions = {
      activateRelativeTab: vi.fn(),
      activateTabByShortcutIndex: vi.fn(),
      closeActiveWorkspaceTab: vi.fn(() => "closed" as const),
      restoreLastDismissedTab: vi.fn(),
    };

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(requestRightPanelBrowserTab).not.toHaveBeenCalled();

    expect(runShortcutHandler("workspace.open-browser-tab", { source: "keyboard" })).toBe(true);
    expect(requestRightPanelBrowserTab).toHaveBeenCalledTimes(1);
  });
});
