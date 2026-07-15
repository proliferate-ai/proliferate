import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";
import type {
  WorkspaceTabContextMenuCommand,
  WorkspaceTabContextMenuItem,
} from "@/lib/domain/workspaces/tabs/context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";

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
): NativeMenuItem[] {
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
