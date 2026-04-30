import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useTerminalTabNativeContextMenu({
  isRuntimeReady,
  onRename,
  onClose,
}: {
  isRuntimeReady: boolean;
  onRename: () => void;
  onClose: () => void;
}) {
  return useNativeContextMenu(() =>
    buildTerminalTabNativeContextMenuItems({
      isRuntimeReady,
      onRename,
      onClose,
    })
  );
}

export function buildTerminalTabNativeContextMenuItems({
  isRuntimeReady,
  onRename,
  onClose,
}: {
  isRuntimeReady: boolean;
  onRename: () => void;
  onClose: () => void;
}): NativeContextMenuItem[] {
  return [
    {
      id: "rename",
      label: "Rename",
      onSelect: onRename,
    },
    {
      id: "close",
      label: "Close",
      enabled: isRuntimeReady,
      onSelect: onClose,
    },
  ];
}
