import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useRepoGroupNativeContextMenu({
  canOpenSettings,
  canRemoveRepo,
  onOpenSettings,
  onRequestRemove,
}: {
  canOpenSettings: boolean;
  canRemoveRepo: boolean;
  onOpenSettings: () => void;
  onRequestRemove: () => void;
}) {
  return useNativeContextMenu(() =>
    buildRepoGroupNativeContextMenuItems({
      canOpenSettings,
      canRemoveRepo,
      onOpenSettings,
      onRequestRemove,
    })
  );
}

export function buildRepoGroupNativeContextMenuItems({
  canOpenSettings,
  canRemoveRepo,
  onOpenSettings,
  onRequestRemove,
}: {
  canOpenSettings: boolean;
  canRemoveRepo: boolean;
  onOpenSettings: () => void;
  onRequestRemove: () => void;
}): NativeContextMenuItem[] {
  const items: NativeContextMenuItem[] = [];
  if (canOpenSettings) {
    items.push({
      id: "settings",
      label: "Settings",
      onSelect: onOpenSettings,
    });
  }
  if (canOpenSettings && canRemoveRepo) {
    items.push({ kind: "separator" });
  }
  if (canRemoveRepo) {
    items.push({
      id: "remove-repository",
      label: "Remove repository",
      onSelect: onRequestRemove,
    });
  }
  return items;
}
