import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useNativeMenu } from "@/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";

export interface WorkspaceActionsNativeMenuInput {
  canRename: boolean;
  canFork: boolean;
  canDismiss: boolean;
  onRename: () => void;
  onFork: () => void;
  onDismiss: () => void;
}

export function useWorkspaceActionsNativeMenu(input: WorkspaceActionsNativeMenuInput) {
  return useNativeMenu(() => buildWorkspaceActionsNativeMenuItems(input));
}

export function buildWorkspaceActionsNativeMenuItems(
  input: WorkspaceActionsNativeMenuInput,
): NativeMenuItem[] {
  return [
    {
      id: "rename-chat",
      label: "Rename chat",
      enabled: input.canRename,
      accelerator: getShortcutNativeAccelerator(SHORTCUTS.renameSession) ?? undefined,
      onSelect: input.onRename,
    },
    {
      id: "fork-chat",
      label: "Fork chat",
      enabled: input.canFork,
      onSelect: input.onFork,
    },
    { kind: "separator" },
    {
      id: "archive-chat",
      label: "Archive chat",
      enabled: input.canDismiss,
      onSelect: input.onDismiss,
    },
  ];
}
