import { describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { buildFileReferenceNativeContextMenuItems } from "#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu";

describe("buildFileReferenceNativeContextMenuItems", () => {
  it("models the native file reference menu with app icons and an Open with submenu", () => {
    const onOpenDefault = vi.fn();
    const onOpenInSidebar = vi.fn();
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
      pathKind: "file",
      canOpenInSidebar: true,
      canOpenExternal: true,
      canReveal: true,
      copyPath: onCopyPath,
      openInSidebar: onOpenInSidebar,
      openDefault: onOpenDefault,
      openWithTarget: onOpenTarget,
      reveal: onReveal,
    });

    expect(items).toMatchObject([
      {
        id: "open-viewer",
        label: "Open in Proliferate",
        enabled: true,
      },
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
    if ("id" in items[1]) items[1].onSelect?.();
    const submenu = items[2];
    if ("kind" in submenu && submenu.kind === "submenu") {
      const firstChild = submenu.items[0];
      const secondChild = submenu.items[1];
      if ("id" in firstChild) firstChild.onSelect?.();
      if ("id" in secondChild) secondChild.onSelect?.();
    }
    if ("id" in items[4]) items[4].onSelect?.();
    if ("id" in items[5]) items[5].onSelect?.();

    expect(onOpenInSidebar).toHaveBeenCalledTimes(1);
    expect(onOpenDefault).toHaveBeenCalledTimes(1);
    expect(onOpenTarget).toHaveBeenNthCalledWith(1, "cursor");
    expect(onOpenTarget).toHaveBeenNthCalledWith(2, "zed");
    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("keeps only editors in Open with and hides Reveal when Finder is the default", () => {
    const finder: OpenTarget = { id: "finder", label: "Finder", kind: "finder", iconId: "finder" };
    const cursor: OpenTarget = { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" };
    const terminal: OpenTarget = {
      id: "terminal",
      label: "Terminal",
      kind: "terminal",
      iconId: "terminal",
    };
    const items = buildFileReferenceNativeContextMenuItems({
      openTargets: [finder, cursor, terminal],
      defaultOpenTarget: finder,
      pathKind: "file",
      canOpenInSidebar: true,
      canOpenExternal: true,
      canReveal: true,
      copyPath: vi.fn(),
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    });

    expect(items).not.toContainEqual(expect.objectContaining({ id: "reveal-in-finder" }));
    const submenu = items.find((item) => "kind" in item && item.kind === "submenu");
    expect(submenu).toMatchObject({
      kind: "submenu",
      items: [{ id: "open-with:cursor" }],
    });
  });

  it("omits the viewer action for folders and keeps Finder capability explicit", () => {
    const items = buildFileReferenceNativeContextMenuItems({
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "directory",
      canOpenInSidebar: false,
      canOpenExternal: false,
      canReveal: false,
      copyPath: vi.fn(),
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    });

    expect(items).toMatchObject([
      { id: "open-default", label: "Open externally", enabled: false },
      { kind: "separator" },
      { id: "copy-path", label: "Copy path" },
      {
        id: "reveal-in-finder",
        label: "Reveal folder in Finder",
        enabled: false,
      },
    ]);
    expect(items).not.toContainEqual(expect.objectContaining({ id: "open-viewer" }));
  });
});
