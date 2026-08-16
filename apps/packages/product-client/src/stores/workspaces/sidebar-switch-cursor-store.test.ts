import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";

afterEach(() => {
  useSidebarSwitchCursorStore.getState().setCursor(null);
});

describe("sidebar-switch-cursor-store", () => {
  it("sets and clears the preview cursor", () => {
    useSidebarSwitchCursorStore.getState().setCursor("workspace-1");
    expect(useSidebarSwitchCursorStore.getState().cursorId).toBe("workspace-1");

    useSidebarSwitchCursorStore.getState().setCursor(null);
    expect(useSidebarSwitchCursorStore.getState().cursorId).toBeNull();
  });

  it("does not notify subscribers when the cursor is set to its current value", () => {
    useSidebarSwitchCursorStore.getState().setCursor("workspace-1");
    const listener = vi.fn();
    const unsubscribe = useSidebarSwitchCursorStore.subscribe(listener);

    useSidebarSwitchCursorStore.getState().setCursor("workspace-1");
    expect(listener).not.toHaveBeenCalled();

    useSidebarSwitchCursorStore.getState().setCursor("workspace-2");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
