import { describe, expect, it, vi } from "vitest";
import { buildTerminalTabNativeContextMenuItems } from "./use-terminal-tab-native-context-menu";

describe("buildTerminalTabNativeContextMenuItems", () => {
  it("models rename and runtime-gated close commands", () => {
    const onRename = vi.fn();
    const onClose = vi.fn();

    const items = buildTerminalTabNativeContextMenuItems({
      isRuntimeReady: false,
      onRename,
      onClose,
    });

    expect(items).toMatchObject([
      { id: "rename", label: "Rename" },
      { id: "close", label: "Close", enabled: false },
    ]);
    if ("id" in items[0]) items[0].onSelect?.();
    if ("id" in items[1]) items[1].onSelect?.();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
