import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";

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
}): NativeMenuItem[] {
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
