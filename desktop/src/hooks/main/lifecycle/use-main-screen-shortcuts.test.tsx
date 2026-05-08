// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useMainScreenShortcuts } from "./use-main-screen-shortcuts";

const harnessState = vi.hoisted(() => ({
  selectedWorkspaceId: null as string | null,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector(harnessState),
}));

vi.mock("@/lib/domain/focus-zone", () => ({
  focusChatInput: vi.fn(() => true),
}));

describe("useMainScreenShortcuts", () => {
  beforeEach(() => {
    harnessState.selectedWorkspaceId = null;
    clearShortcutHandlerRegistryForTests();
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.clearAllMocks();
  });

  it("keeps the left-sidebar toggle shell-scoped when no workspace is selected", () => {
    const onToggleLeftSidebar = vi.fn();
    const onToggleRightPanel = vi.fn();

    renderHook(() => useMainScreenShortcuts({
      canOpenCommandPalette: false,
      onOpenCommandPalette: vi.fn(),
      onOpenTerminal: vi.fn(),
      onToggleLeftSidebar,
      onToggleRightPanel,
    }));

    expect(runShortcutHandler("workspace.toggle-left-sidebar", { source: "keyboard" })).toBe(true);
    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);

    expect(runShortcutHandler("workspace.toggle-right-panel", { source: "keyboard" })).toBe(false);
    expect(onToggleRightPanel).not.toHaveBeenCalled();
  });

  it("registers workspace-scoped shortcuts when a workspace is selected", () => {
    harnessState.selectedWorkspaceId = "workspace-1";
    const onOpenTerminal = vi.fn(() => true);
    const onToggleRightPanel = vi.fn();

    renderHook(() => useMainScreenShortcuts({
      canOpenCommandPalette: true,
      onOpenCommandPalette: vi.fn(),
      onOpenTerminal,
      onToggleLeftSidebar: vi.fn(),
      onToggleRightPanel,
    }));

    expect(runShortcutHandler("workspace.open-terminal", { source: "keyboard" })).toBe(true);
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);

    expect(runShortcutHandler("workspace.toggle-right-panel", { source: "keyboard" })).toBe(true);
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
  });
});
