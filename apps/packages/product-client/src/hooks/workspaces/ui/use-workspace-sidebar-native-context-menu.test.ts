import { describe, expect, it } from "vitest";
import { buildWorkspaceSidebarNativeContextMenuItems } from "#product/hooks/workspaces/ui/use-workspace-sidebar-native-context-menu";

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

  it("appends workspace-copy availability commands and dispatches by kind (right-click parity)", () => {
    let dispatched: string | null = null;
    const items = buildWorkspaceSidebarNativeContextMenuItems({
      canRename: false,
      canCopyWorkspaceLocation: false,
      copyWorkspaceLocationLabel: "Copy workspace path",
      canCopyBranchName: false,
      branchName: null,
      canOpenPullRequest: false,
      pullRequestNumber: null,
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
      availabilityCommands: [
        { kind: "unlink-this-mac", label: "Unlink this Mac…" },
        {
          kind: "unsupported-git-state",
          label: "Unsupported Git state",
          blocker: "This workspace has uncommitted changes.",
        },
      ],
      onAvailabilityCommand: (kind) => { dispatched = kind; },
    });

    const unlink = items.find((i) => "id" in i && i.id === "availability-unlink-this-mac");
    const blocker = items.find((i) => "id" in i && i.id === "availability-unsupported-git-state");
    expect(unlink).toBeDefined();
    expect(blocker).toBeDefined();
    if (blocker && "enabled" in blocker) expect(blocker.enabled).toBe(false);
    if (unlink && "onSelect" in unlink) unlink.onSelect?.();
    expect(dispatched).toBe("unlink-this-mac");
    if (blocker && "onSelect" in blocker) blocker.onSelect?.();
    expect(dispatched).toBe("unlink-this-mac");
  });
});
