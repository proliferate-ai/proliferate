import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";

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
}): NativeMenuItem[] {
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
