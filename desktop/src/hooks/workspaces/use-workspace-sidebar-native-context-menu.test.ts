import { describe, expect, it } from "vitest";
import { buildWorkspaceSidebarNativeContextMenuItems } from "./use-workspace-sidebar-native-context-menu";

describe("buildWorkspaceSidebarNativeContextMenuItems", () => {
  it("shows rename and archive for an active workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: true,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: false,
      onRename: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "rename", label: "Rename" },
      { id: "archive", label: "Archive" },
    ]);
  });

  it("shows unarchive for an archived workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      archived: true,
      canArchive: false,
      canUnarchive: true,
      canMarkDone: false,
      onRename: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([{ id: "unarchive", label: "Unarchive" }]);
  });

  it("shows delete workspace before archive when supported", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: true,
      onRename: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "mark-done", label: "Delete workspace..." },
      { id: "archive", label: "Archive" },
    ]);
  });
});
