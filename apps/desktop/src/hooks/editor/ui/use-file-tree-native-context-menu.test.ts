import { describe, expect, it, vi } from "vitest";
import { buildFileTreeNativeContextMenuItems } from "./use-file-tree-native-context-menu";

describe("buildFileTreeNativeContextMenuItems", () => {
  it("models Proliferate open plus configured open targets", () => {
    const onOpenInProliferate = vi.fn();
    const onOpenTarget = vi.fn();

    const items = buildFileTreeNativeContextMenuItems({
      targets: [
        { id: "finder", label: "Finder" },
        { id: "copy-path", label: "Copy path" },
      ],
      onOpenInProliferate,
      onOpenTarget,
    });

    expect(items).toMatchObject([
      { id: "open-in-proliferate", label: "Open in Proliferate" },
      { kind: "separator" },
      { id: "open-target:finder", label: "Finder" },
      { id: "open-target:copy-path", label: "Copy path" },
    ]);
    if ("id" in items[0]) items[0].onSelect?.();
    if ("id" in items[2]) items[2].onSelect?.();
    if ("id" in items[3]) items[3].onSelect?.();
    expect(onOpenInProliferate).toHaveBeenCalledTimes(1);
    expect(onOpenTarget).toHaveBeenNthCalledWith(1, "finder");
    expect(onOpenTarget).toHaveBeenNthCalledWith(2, "copy-path");
  });

  it("includes file actions only when handlers are supplied", () => {
    const onNewFile = vi.fn();
    const onNewFolder = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    const items = buildFileTreeNativeContextMenuItems({
      targets: [],
      onOpenInProliferate: vi.fn(),
      onOpenTarget: vi.fn(),
      onNewFile,
      onNewFolder,
      onRename,
      onDelete,
    });

    expect(items).toMatchObject([
      { id: "open-in-proliferate" },
      { kind: "separator" },
      { id: "new-file", label: "New File" },
      { id: "new-folder", label: "New Folder" },
      { kind: "separator" },
      { id: "rename", label: "Rename" },
      { id: "delete", label: "Delete" },
    ]);
    if ("id" in items[2]) items[2].onSelect?.();
    if ("id" in items[3]) items[3].onSelect?.();
    if ("id" in items[5]) items[5].onSelect?.();
    if ("id" in items[6]) items[6].onSelect?.();
    expect(onNewFile).toHaveBeenCalledTimes(1);
    expect(onNewFolder).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
