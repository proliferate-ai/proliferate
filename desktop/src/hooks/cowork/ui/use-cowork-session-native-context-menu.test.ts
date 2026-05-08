import { describe, expect, it, vi } from "vitest";
import { buildCoworkSessionNativeContextMenuItems } from "./use-cowork-session-native-context-menu";

describe("buildCoworkSessionNativeContextMenuItems", () => {
  it("models rename and archive commands", () => {
    const onRename = vi.fn();
    const onArchive = vi.fn();
    const items = buildCoworkSessionNativeContextMenuItems({ onRename, onArchive });

    expect(items).toMatchObject([
      { id: "rename", label: "Rename" },
      { id: "archive", label: "Archive" },
    ]);
    if ("id" in items[0]) items[0].onSelect?.();
    if ("id" in items[1]) items[1].onSelect?.();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});
