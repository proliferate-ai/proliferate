import { SHORTCUTS } from "@/config/shortcuts";
import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
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
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onArchive,
  onUnarchive,
  onMarkDone,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
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
      onRename,
      onCopyWorkspaceLocation,
      onCopyBranchName,
      onArchive,
      onUnarchive,
      onMarkDone,
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
  onRename,
  onCopyWorkspaceLocation,
  onCopyBranchName,
  onArchive,
  onUnarchive,
  onMarkDone,
}: {
  canRename: boolean;
  canCopyWorkspaceLocation: boolean;
  copyWorkspaceLocationLabel: string;
  canCopyBranchName: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
  onCopyWorkspaceLocation: () => void;
  onCopyBranchName: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
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
      icon: { kind: "native", name: "copy" },
      onSelect: onCopyWorkspaceLocation,
    });
  }

  if (canCopyBranchName) {
    items.push({
      id: "copy-branch-name",
      label: "Copy branch name",
      accelerator: getShortcutNativeAccelerator(SHORTCUTS.copyBranchName) ?? undefined,
      icon: { kind: "native", name: "copy" },
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
