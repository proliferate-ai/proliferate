import { describe, expect, it, vi } from "vitest";
import { buildRepoGroupNativeContextMenuItems } from "./use-repo-group-native-context-menu";

describe("buildRepoGroupNativeContextMenuItems", () => {
  it("models settings and destructive remove as separate commands", () => {
    const onOpenSettings = vi.fn();
    const onRequestRemove = vi.fn();
    const items = buildRepoGroupNativeContextMenuItems({
      canOpenSettings: true,
      canRemoveRepo: true,
      onOpenSettings,
      onRequestRemove,
    });

    expect(items).toMatchObject([
      { id: "settings", label: "Settings" },
      { kind: "separator" },
      { id: "remove-repository", label: "Remove repository" },
    ]);
    if ("id" in items[0]) items[0].onSelect?.();
    if ("id" in items[2]) items[2].onSelect?.();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onRequestRemove).toHaveBeenCalledTimes(1);
  });
});
