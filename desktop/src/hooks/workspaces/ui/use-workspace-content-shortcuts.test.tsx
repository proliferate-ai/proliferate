// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: "workspace-1" as string | null,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector(harnessState),
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

  it("uses Cmd+T for a new chat tab", () => {
    const actions = {
      activateRelativeTab: vi.fn(),
      activateTabByShortcutIndex: vi.fn(),
      closeActiveWorkspaceTab: vi.fn(() => "closed" as const),
      openNewSessionTab: vi.fn(() => true),
      restoreLastDismissedTab: vi.fn(),
    };

    renderHook(() => useWorkspaceContentShortcuts(actions));

    expect(actions.openNewSessionTab).not.toHaveBeenCalled();

    expect(runShortcutHandler("workspace.new-session-tab", { source: "keyboard" })).toBe(true);
    expect(actions.openNewSessionTab).toHaveBeenCalledTimes(1);
  });
});
