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
});
