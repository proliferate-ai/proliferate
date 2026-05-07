import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/lib/access/tauri/context-menu";

export function useFilePathNativeContextMenu({
  canOpen,
  onOpen,
  onCopy,
}: {
  canOpen: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return useNativeContextMenu(() =>
    buildFilePathNativeContextMenuItems({
      canOpen,
      onOpen,
      onCopy,
    })
  );
}

export function buildFilePathNativeContextMenuItems({
  canOpen,
  onOpen,
  onCopy,
}: {
  canOpen: boolean;
  onOpen: () => void;
  onCopy: () => void;
}): NativeContextMenuItem[] {
  return [
    {
      id: "open-file",
      label: "Open file",
      enabled: canOpen,
      onSelect: onOpen,
    },
    {
      id: "copy-path",
      label: "Copy path",
      onSelect: onCopy,
    },
  ];
}
