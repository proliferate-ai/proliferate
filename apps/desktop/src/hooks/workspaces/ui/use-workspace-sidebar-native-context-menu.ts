import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import type { NativeContextMenuItem } from "@/lib/access/tauri/context-menu";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";

export function useWorkspaceSidebarNativeContextMenu({
  canRename,
  canCopyWorkspaceLocation,
  copyWorkspaceLocationLabel,
  canCopyBranchName,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  canMoveToCloud,
  moveToCloudLabel,
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onArchive,
  onUnarchive,
  onMarkDone,
  onMoveToCloud,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  canMoveToCloud: boolean;
  /** Direction-aware label (spec section 2.6, "Direction inference at the entry
   *  points"): "Move to cloud…" for a local workspace, "Move to this Mac…" for a
   *  cloud-backed one. Defaults to the local-to-cloud copy for existing callers. */
  moveToCloudLabel?: string;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
  onMoveToCloud: () => void;
}) {
  return useNativeContextMenu(() =>
    buildWorkspaceSidebarNativeContextMenuItems({
      canRename,
      canCopyWorkspaceLocation,
      copyWorkspaceLocationLabel,
      canCopyBranchName,
      archived,
      canArchive,
      canUnarchive,
      canMarkDone,
      canMoveToCloud,
      moveToCloudLabel,
      onRename,
      onCopyWorkspaceLocation,
      onCopyBranchName,
      onArchive,
      onUnarchive,
      onMarkDone,
      onMoveToCloud,
    })
  );
}

export function buildWorkspaceSidebarNativeContextMenuItems({
  canRename,
  canCopyWorkspaceLocation,
  copyWorkspaceLocationLabel,
  canCopyBranchName,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  canMoveToCloud,
  moveToCloudLabel = "Move to cloud…",
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onArchive,
  onUnarchive,
  onMarkDone,
  onMoveToCloud,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  canMoveToCloud: boolean;
  moveToCloudLabel?: string;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
  onMoveToCloud: () => void;
}): NativeContextMenuItem[] {
  const items: NativeContextMenuItem[] = [];
  if (canRename) {
    items.push({
      id: "rename",
      label: "Rename",
      onSelect: onRename,
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

  if (canCopyBranchName) {
    items.push({
      id: "copy-branch-name",
      label: "Copy branch name",
      accelerator: getShortcutNativeAccelerator(SHORTCUTS.copyBranchName) ?? undefined,
      onSelect: onCopyBranchName,
    });
  }

  if (canMoveToCloud) {
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      id: "move-to-cloud",
      label: moveToCloudLabel,
      onSelect: onMoveToCloud,
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

  return items;
}
