import { describe, expect, it } from "vitest";
import { buildWorkspaceSidebarNativeContextMenuItems } from "./use-workspace-sidebar-native-context-menu";

describe("buildWorkspaceSidebarNativeContextMenuItems", () => {
  it("shows rename and archive for an active workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: true,
      canCopyWorkspaceLocation: true,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: true,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: false,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "rename", label: "Rename" },
      { id: "copy-workspace-location", label: "Copy workspace path", accelerator: "CmdOrCtrl+Shift+C" },
      { id: "copy-branch-name", label: "Copy branch name", accelerator: "CmdOrCtrl+Alt+C" },
      { id: "archive", label: "Archive..." },
    ]);
  });

  it("shows unarchive for an archived workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: false,
      archived: true,
      canArchive: false,
      canUnarchive: true,
      canMarkDone: false,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([{ id: "unarchive", label: "Unarchive" }]);
  });

  it("shows delete workspace before archive when supported", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: false,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: true,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "mark-done", label: "Delete workspace..." },
      { id: "archive", label: "Archive..." },
    ]);
  });
});
