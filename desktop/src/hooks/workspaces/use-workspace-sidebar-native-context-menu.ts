import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useWorkspaceSidebarNativeContextMenu({
  canRename,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  onRename,
  onArchive,
  onUnarchive,
  onMarkDone,
}: {
  canRename: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkDone: () => void;
}) {
  return useNativeContextMenu(() =>
    buildWorkspaceSidebarNativeContextMenuItems({
      canRename,
      archived,
      canArchive,
      canUnarchive,
      canMarkDone,
      onRename,
      onArchive,
      onUnarchive,
      onMarkDone,
    })
  );
}

export function buildWorkspaceSidebarNativeContextMenuItems({
  canRename,
  archived,
  canArchive,
  canUnarchive,
  canMarkDone,
  onRename,
  onArchive,
  onUnarchive,
  onMarkDone,
}: {
  canRename: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkDone: boolean;
  onRename: () => void;
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
      label: "Archive",
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
