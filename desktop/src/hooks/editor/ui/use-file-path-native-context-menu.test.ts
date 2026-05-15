import { describe, expect, it, vi } from "vitest";
import { buildFilePathNativeContextMenuItems } from "./use-file-path-native-context-menu";

describe("buildFilePathNativeContextMenuItems", () => {
  it("disables open when no absolute path is available", () => {
    const items = buildFilePathNativeContextMenuItems({
      canOpen: false,
      onOpen: vi.fn(),
      onCopy: vi.fn(),
    });

    expect(items).toMatchObject([
      { id: "open-default", label: "Open in \"Your default\"", enabled: false },
      { kind: "separator" },
      { id: "copy-path", label: "Copy path" },
      { id: "reveal-in-finder", label: "Reveal in Finder", enabled: false },
    ]);
  });

  it("includes path-based open targets when available", () => {
    const onOpenTarget = vi.fn();
    const items = buildFilePathNativeContextMenuItems({
      canOpen: true,
      targets: [
        { id: "finder", label: "Finder" },
        { id: "code", label: "VS Code" },
        { id: "copy-path", label: "Copy path" },
      ],
      onOpen: vi.fn(),
      onOpenTarget,
      onCopy: vi.fn(),
      onRevealInFinder: vi.fn(),
    });

    expect(items).toMatchObject([
      { id: "open-default", label: "Open in \"Your default\"", enabled: true },
      { id: "open-in", label: "Open in >", enabled: false },
      { id: "open-target:code", label: "VS Code", enabled: true },
      { kind: "separator" },
      { id: "copy-path", label: "Copy path" },
      { id: "reveal-in-finder", label: "Reveal in Finder", enabled: true },
    ]);
    if ("id" in items[2]) items[2].onSelect?.();
    expect(onOpenTarget).toHaveBeenCalledWith("code");
  });
});
