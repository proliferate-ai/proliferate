import { describe, expect, it } from "vitest";
import { buildWorkspaceSidebarNativeContextMenuItems } from "./use-workspace-sidebar-native-context-menu";

describe("buildWorkspaceSidebarNativeContextMenuItems", () => {
  it("shows rename and archive for an active workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: true,
      canCopyWorkspaceLocation: true,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: true,
      branchName: null,
      canOpenPullRequest: false,
      pullRequestNumber: null,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: false,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onOpenPullRequest: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "rename", label: "Rename" },
      { id: "archive", label: "Archive..." },
      { id: "copy-workspace-location", label: "Copy workspace path", accelerator: "CmdOrCtrl+Shift+C" },
      { kind: "separator" },
      { id: "copy-branch-name", label: "Copy branch name", accelerator: "CmdOrCtrl+Alt+C" },
    ]);
  });

  it("shows unarchive for an archived workspace", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: false,
      branchName: null,
      canOpenPullRequest: false,
      pullRequestNumber: null,
      archived: true,
      canArchive: false,
      canUnarchive: true,
      canMarkDone: false,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onOpenPullRequest: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([{ id: "unarchive", label: "Unarchive" }]);
  });

  it("keeps archive with workspace actions and delete in the final destructive group", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: false,
      branchName: null,
      canOpenPullRequest: false,
      pullRequestNumber: null,
      archived: false,
      canArchive: true,
      canUnarchive: false,
      canMarkDone: true,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onOpenPullRequest: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "archive", label: "Archive..." },
      { kind: "separator" },
      { id: "mark-done", label: "Delete workspace..." },
    ]);
  });

  it("keeps pull request and branch context in the native menu", () => {
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: true,
      branchName: "feature/native-menus",
      canOpenPullRequest: true,
      pullRequestNumber: 381,
      archived: false,
      canArchive: false,
      canUnarchive: false,
      canMarkDone: false,
      onRename: () => {},
      onCopyWorkspaceLocation: () => {},
      onCopyBranchName: () => {},
      onOpenPullRequest: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onMarkDone: () => {},
    });

    expect(items).toMatchObject([
      { id: "open-pull-request", label: "Open pull request #381" },
      { id: "current-branch", label: "feature/native-menus", enabled: false },
      { id: "copy-branch-name", label: "Copy branch name" },
    ]);
  });
});
