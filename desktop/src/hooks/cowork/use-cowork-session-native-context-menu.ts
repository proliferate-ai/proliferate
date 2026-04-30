import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useCoworkSessionNativeContextMenu({
  onRename,
  onArchive,
}: {
  onRename: () => void;
  onArchive: () => void;
}) {
  return useNativeContextMenu(() =>
    buildCoworkSessionNativeContextMenuItems({
      onRename,
      onArchive,
    })
  );
}

export function buildCoworkSessionNativeContextMenuItems({
  onRename,
  onArchive,
}: {
  onRename: () => void;
  onArchive: () => void;
}): NativeContextMenuItem[] {
  return [
    {
      id: "rename",
      label: "Rename",
      onSelect: onRename,
    },
    {
      id: "archive",
      label: "Archive",
      onSelect: onArchive,
    },
  ];
}
