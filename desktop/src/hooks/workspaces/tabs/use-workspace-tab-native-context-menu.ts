import { SHORTCUTS } from "@/config/shortcuts";
import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";
import type {
  WorkspaceTabContextMenuCommand,
  WorkspaceTabContextMenuItem,
} from "@/lib/domain/workspaces/tabs/context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";

export function useWorkspaceTabNativeContextMenu({
  items,
  onSelect,
}: {
  items: readonly WorkspaceTabContextMenuItem[];
  onSelect: (command: WorkspaceTabContextMenuCommand) => void;
}) {
  return useNativeContextMenu(() => {
    return buildNativeWorkspaceTabContextMenuItems(items, onSelect);
  });
}

function buildNativeWorkspaceTabContextMenuItems(
  items: readonly WorkspaceTabContextMenuItem[],
  onSelect: (command: WorkspaceTabContextMenuCommand) => void,
): NativeContextMenuItem[] {
  return items.map((item) => {
    if (item.kind === "separator") {
      return { kind: "separator" };
    }

    const shortcut = item.shortcutKey ? SHORTCUTS[item.shortcutKey] : null;
    return {
      id: item.command,
      label: item.label,
      ...(shortcut
        ? { accelerator: getShortcutNativeAccelerator(shortcut) ?? undefined }
        : {}),
      onSelect: () => onSelect(item.command),
    };
  });
}
