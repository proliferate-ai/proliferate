import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useWorkspaceSidebarNativeContextMenu({
  canRename,
  archived,
  canArchive,
  canUnarchive,
  onRename,
  onArchive,
  onUnarchive,
}: {
  canRename: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  return useNativeContextMenu(() =>
    buildWorkspaceSidebarNativeContextMenuItems({
      canRename,
      archived,
      canArchive,
      canUnarchive,
      onRename,
      onArchive,
      onUnarchive,
    })
  );
}

export function buildWorkspaceSidebarNativeContextMenuItems({
  canRename,
  archived,
  canArchive,
  canUnarchive,
  onRename,
  onArchive,
  onUnarchive,
}: {
  canRename: boolean;
  archived: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}): NativeContextMenuItem[] {
  const items: NativeContextMenuItem[] = [];
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
