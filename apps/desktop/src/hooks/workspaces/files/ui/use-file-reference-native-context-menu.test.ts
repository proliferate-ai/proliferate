import { describe, expect, it, vi } from "vitest";
import { buildFileReferenceNativeContextMenuItems } from "./use-file-reference-native-context-menu";
import type { OpenTarget } from "@/lib/access/tauri/shell";

describe("buildFileReferenceNativeContextMenuItems", () => {
  it("models the native file reference menu with app icons and an Open with submenu", () => {
    const onOpenDefault = vi.fn();
    const onOpenTarget = vi.fn();
    const onCopyPath = vi.fn();
    const onReveal = vi.fn();
    const targets: OpenTarget[] = [
      { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
      { id: "zed", label: "Zed", kind: "editor", iconId: "zed" },
      { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      { id: "copy-path", label: "Copy path", kind: "copy" },
    ];

    const items = buildFileReferenceNativeContextMenuItems({
      openTargets: targets,
      defaultOpenTarget: targets[0],
      canOpenExternal: true,
      copyPath: onCopyPath,
      openDefault: onOpenDefault,
      openWithTarget: onOpenTarget,
      reveal: onReveal,
    });

    expect(items).toMatchObject([
      {
        id: "open-default",
        label: "Open in Cursor",
        enabled: true,
        icon: { kind: "resource", path: "app-icons/cursor.png" },
      },
      {
        kind: "submenu",
        submenuId: "open-with",
        label: "Open with",
        enabled: true,
        items: [
          {
            id: "open-with:cursor",
            label: "Cursor",
            icon: { kind: "resource", path: "app-icons/cursor.png" },
          },
          {
            id: "open-with:zed",
            label: "Zed",
            icon: { kind: "resource", path: "app-icons/zed.png" },
          },
          {
            id: "open-with:terminal",
            label: "Terminal",
            icon: { kind: "resource", path: "app-icons/terminal.png" },
          },
        ],
      },
      { kind: "separator" },
      {
        id: "copy-path",
        label: "Copy path",
      },
      {
        id: "reveal-in-finder",
        label: "Reveal in Finder",
      },
    ]);

    if ("id" in items[0]) items[0].onSelect?.();
    const submenu = items[1];
    if ("kind" in submenu && submenu.kind === "submenu") {
      const firstChild = submenu.items[0];
      const thirdChild = submenu.items[2];
      if ("id" in firstChild) firstChild.onSelect?.();
      if ("id" in thirdChild) thirdChild.onSelect?.();
    }
    if ("id" in items[3]) items[3].onSelect?.();
    if ("id" in items[4]) items[4].onSelect?.();

    expect(onOpenDefault).toHaveBeenCalledTimes(1);
    expect(onOpenTarget).toHaveBeenNthCalledWith(1, "cursor");
    expect(onOpenTarget).toHaveBeenNthCalledWith(2, "terminal");
    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});
