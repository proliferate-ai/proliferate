import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import type { NativeContextMenuItem } from "@/lib/access/tauri/context-menu";

export function useChatDiffLineWrapNativeContextMenu({
  wrapLongLines,
  onToggleWrapLongLines,
}: {
  wrapLongLines: boolean;
  onToggleWrapLongLines: () => void;
}) {
  return useNativeContextMenu(() =>
    buildChatDiffLineWrapNativeContextMenuItems({
      wrapLongLines,
      onToggleWrapLongLines,
    })
  );
}

export function buildChatDiffLineWrapNativeContextMenuItems({
  wrapLongLines,
  onToggleWrapLongLines,
}: {
  wrapLongLines: boolean;
  onToggleWrapLongLines: () => void;
}): NativeContextMenuItem[] {
  return [
    {
      id: "toggle-chat-diff-line-wrap",
      label: wrapLongLines ? "Turn line wrapping off" : "Turn line wrapping on",
      onSelect: onToggleWrapLongLines,
    },
  ];
}
