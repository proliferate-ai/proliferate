import { describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { buildFileReferenceNativeContextMenuItems } from "#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu";

const targets: OpenTarget[] = [
  { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
  { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
  { id: "copy-path", label: "Copy path", kind: "copy" },
];

describe("buildFileReferenceNativeContextMenuItems", () => {
  it("models only current eligible settled actions", () => {
    const actions = callbacks();
    const items = buildFileReferenceNativeContextMenuItems({
      ...actions,
      accessState: { status: "settled" },
      openTargets: targets,
      defaultOpenTarget: targets[0],
      pathKind: "file",
      canOpenInSidebar: true,
      canOpenExternal: true,
      canReveal: true,
      copyPath: "/repo/src/App.tsx",
    });

    expect(items).toMatchObject([
      { id: "open-viewer", label: "Open in viewer", enabled: true },
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
        items: [
          { id: "open-with:cursor", label: "Cursor" },
          { id: "open-with:terminal", label: "Terminal" },
        ],
      },
      { kind: "separator" },
      { id: "copy-path", label: "Copy path", enabled: true },
      { id: "reveal-in-finder", label: "Reveal in Finder", enabled: true },
    ]);

    select(items[0]);
    select(items[1]);
    const submenu = items[2];
    if ("kind" in submenu && submenu.kind === "submenu") {
      select(submenu.items[0]);
      select(submenu.items[1]);
    }
    select(items[4]);
    select(items[5]);
    expect(actions.openInSidebar).toHaveBeenCalledOnce();
    expect(actions.openDefault).toHaveBeenCalledOnce();
    expect(actions.openWithTarget).toHaveBeenNthCalledWith(1, "cursor");
    expect(actions.openWithTarget).toHaveBeenNthCalledWith(2, "terminal");
    expect(actions.copyCurrentPath).toHaveBeenCalledOnce();
    expect(actions.reveal).toHaveBeenCalledOnce();
  });

  it("returns exactly Copy path for any non-settled nonempty reference", () => {
    const actions = callbacks();
    for (const status of ["pending", "exact-missing", "recovering", "unavailable"]) {
      const items = buildFileReferenceNativeContextMenuItems({
        ...actions,
        accessState: { status },
        openTargets: targets,
        defaultOpenTarget: targets[0],
        pathKind: null,
        canOpenInSidebar: false,
        canOpenExternal: false,
        canReveal: false,
        copyPath: "missing.ts",
      });
      expect(items).toMatchObject([
        { id: "copy-path", label: "Copy path", enabled: true },
      ]);
      expect(items).toHaveLength(1);
      select(items[0]);
    }
    expect(actions.copyCurrentPath).toHaveBeenCalledTimes(4);
    expect(actions.openDefault).not.toHaveBeenCalled();
    expect(actions.reveal).not.toHaveBeenCalled();
  });

  it("returns an empty model when the current copy path is null", () => {
    const actions = callbacks();
    expect(buildFileReferenceNativeContextMenuItems({
      ...actions,
      accessState: { status: "unavailable" },
      openTargets: targets,
      defaultOpenTarget: targets[0],
      pathKind: null,
      canOpenInSidebar: false,
      canOpenExternal: false,
      canReveal: false,
      copyPath: null,
    })).toEqual([]);
  });

  it("renders a remote workspace file as viewer plus Copy path", () => {
    const actions = callbacks();
    const items = buildFileReferenceNativeContextMenuItems({
      ...actions,
      accessState: { status: "settled" },
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "file",
      canOpenInSidebar: true,
      canOpenExternal: false,
      canReveal: false,
      copyPath: "src/App.tsx",
    });
    expect(items).toMatchObject([
      { id: "open-viewer", label: "Open in viewer", enabled: true },
      { kind: "separator" },
      { id: "copy-path", label: "Copy path", enabled: true },
    ]);
    expect(items).toHaveLength(3);
    select(items[0]);
    select(items[2]);
    expect(actions.openInSidebar).toHaveBeenCalledOnce();
    expect(actions.copyCurrentPath).toHaveBeenCalledOnce();
    expect(actions.openDefault).not.toHaveBeenCalled();
    expect(actions.reveal).not.toHaveBeenCalled();
  });

  it("renders a remote settled directory as exactly Copy path", () => {
    const items = buildFileReferenceNativeContextMenuItems({
      ...callbacks(),
      accessState: { status: "settled" },
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "directory",
      canOpenInSidebar: false,
      canOpenExternal: false,
      canReveal: false,
      copyPath: ".",
    });
    expect(items).toMatchObject([
      { id: "copy-path", label: "Copy path", enabled: true },
    ]);
    expect(items).toHaveLength(1);
  });

  it("renders an ordinary local workspace directory as Copy path plus reveal", () => {
    const actions = callbacks();
    const items = buildFileReferenceNativeContextMenuItems({
      ...actions,
      accessState: { status: "settled" },
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "directory",
      canOpenInSidebar: false,
      canOpenExternal: false,
      canReveal: true,
      copyPath: "/repo",
    });
    expect(items).toMatchObject([
      { id: "copy-path", label: "Copy path", enabled: true },
      { id: "reveal-in-finder", label: "Reveal folder in Finder", enabled: true },
    ]);
    expect(items).toHaveLength(2);
    select(items[0]);
    select(items[1]);
    expect(actions.copyCurrentPath).toHaveBeenCalledOnce();
    expect(actions.reveal).toHaveBeenCalledOnce();
    expect(actions.openDefault).not.toHaveBeenCalled();
    expect(actions.openWithTarget).not.toHaveBeenCalled();
  });
});

function callbacks() {
  return {
    copyCurrentPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  };
}

function select(item: ReturnType<typeof buildFileReferenceNativeContextMenuItems>[number]) {
  if ("id" in item) item.onSelect?.();
}
