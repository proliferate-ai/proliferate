import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceActionsNativeMenuItems } from "./use-workspace-actions-native-menu";

describe("buildWorkspaceActionsNativeMenuItems", () => {
  it("keeps the header overflow menu chat-only", () => {
    const onRename = vi.fn();
    const items = buildWorkspaceActionsNativeMenuItems({
      canRename: true,
      canFork: false,
      canDismiss: true,
      onRename,
      onFork: vi.fn(),
      onDismiss: vi.fn(),
    });

    expect(items).toMatchObject([
      { id: "rename-chat", label: "Rename chat", enabled: true },
      { id: "fork-chat", label: "Fork chat", enabled: false },
      { kind: "separator" },
      { id: "archive-chat", label: "Archive chat", enabled: true },
    ]);
    const rename = items[0];
    if (rename && "onSelect" in rename) rename.onSelect?.();
    expect(onRename).toHaveBeenCalledOnce();
    expect(items.some((item) => "id" in item && /commit|push|pull-request/.test(item.id))).toBe(false);
  });
});
