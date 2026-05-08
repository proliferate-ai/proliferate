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
      { id: "open-file", label: "Open file", enabled: false },
      { id: "copy-path", label: "Copy path" },
    ]);
  });
});
