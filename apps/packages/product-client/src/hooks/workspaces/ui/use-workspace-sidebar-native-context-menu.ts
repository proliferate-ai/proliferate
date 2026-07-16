import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useNativeContextMenu } from "#product/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";
import { getShortcutNativeAccelerator } from "#product/lib/domain/shortcuts/native-accelerators";
import type {
  WorkspaceAvailabilityCommand,
  WorkspaceAvailabilityCommandKind,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";

export function useWorkspaceSidebarNativeContextMenu({
  canRename,
  canCopyWorkspaceLocation,
  copyWorkspaceLocationLabel,
  canCopyBranchName,
  branchName,
  canOpenPullRequest,
  pullRequestNumber,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onOpenPullRequest,
  onArchive,
  onUnarchive,
  onMarkDone,
  availabilityCommands,
  onAvailabilityCommand,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  branchName: string | null;
  canOpenPullRequest: boolean;
  pullRequestNumber: number | null;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onOpenPullRequest: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
}) {
  return useNativeContextMenu(() =>
    buildWorkspaceSidebarNativeContextMenuItems({
      canRename,
      canCopyWorkspaceLocation,
      copyWorkspaceLocationLabel,
      canCopyBranchName,
      branchName,
      canOpenPullRequest,
      pullRequestNumber,
      archived,
      canArchive,
      canUnarchive,
      canMarkDone,
      onRename,
      onCopyWorkspaceLocation,
      onCopyBranchName,
      onOpenPullRequest,
      onArchive,
      onUnarchive,
      onMarkDone,
      availabilityCommands,
      onAvailabilityCommand,
    })
  );
}

export function buildWorkspaceSidebarNativeContextMenuItems({
  canRename,
  canCopyWorkspaceLocation,
  copyWorkspaceLocationLabel,
  canCopyBranchName,
  branchName,
  canOpenPullRequest,
  pullRequestNumber,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onOpenPullRequest,
  onArchive,
  onUnarchive,
  onMarkDone,
  availabilityCommands,
  onAvailabilityCommand,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  branchName: string | null;
  canOpenPullRequest: boolean;
  pullRequestNumber: number | null;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onOpenPullRequest: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
}): NativeMenuItem[] {
  const items: NativeMenuItem[] = [];
  if (canRename) {
    items.push({
      id: "rename",
      label: "Rename",
      onSelect: onRename,
    });
  }

  if (!archived && canArchive) {
    items.push({
      id: "archive",
      label: "Archive...",
      onSelect: onArchive,
    });
  }

  if (archived && canUnarchive) {
    items.push({
      id: "unarchive",
      label: "Unarchive",
      onSelect: onUnarchive,
    });
  }

  if (canCopyWorkspaceLocation) {
    items.push({
      id: "copy-workspace-location",
      label: copyWorkspaceLocationLabel,
      accelerator: getShortcutNativeAccelerator(SHORTCUTS.copyWorkspacePath) ?? undefined,
      onSelect: onCopyWorkspaceLocation,
    });
  }

  const hasGitItems = canOpenPullRequest || !!branchName || canCopyBranchName;
  if (hasGitItems && items.length > 0) {
    items.push({ kind: "separator" });
  }

  if (canOpenPullRequest) {
    items.push({
      id: "open-pull-request",
      label: pullRequestNumber === null
        ? "Open pull request"
        : `Open pull request #${pullRequestNumber}`,
      onSelect: onOpenPullRequest,
    });
  }

  if (branchName) {
    items.push({
      id: "current-branch",
      label: branchName,
      enabled: false,
    });
  }

  if (canCopyBranchName) {
    items.push({
      id: "copy-branch-name",
      label: "Copy branch name",
      accelerator: getShortcutNativeAccelerator(SHORTCUTS.copyBranchName) ?? undefined,
      onSelect: onCopyBranchName,
    });
  }

  if (canMarkDone) {
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      id: "mark-done",
      label: "Delete workspace...",
      onSelect: onMarkDone,
    });
  }

  const availability = availabilityCommands ?? [];
  if (availability.length > 0) {
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    for (const command of availability) {
      const isBlocker = command.kind === "unsupported-git-state";
      items.push({
        id: `availability-${command.kind}`,
        label: command.blocker ? `${command.label} — ${command.blocker}` : command.label,
        enabled: !isBlocker,
        onSelect: () => {
          if (!isBlocker) onAvailabilityCommand?.(command.kind);
        },
      });
    }
  }

  return items;
}
