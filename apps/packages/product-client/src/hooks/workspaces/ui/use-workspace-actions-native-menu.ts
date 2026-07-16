import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useNativeMenu } from "#product/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";
import { getShortcutNativeAccelerator } from "#product/lib/domain/shortcuts/native-accelerators";
import type {
  WorkspaceAvailabilityCommand,
  WorkspaceAvailabilityCommandKind,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";

export interface WorkspaceActionsNativeMenuInput {
  canRename: boolean;
  canFork: boolean;
  canDismiss: boolean;
  onRename: () => void;
  onFork: () => void;
  onDismiss: () => void;
  /** Workspace-copy availability commands (PR 5), resolved from the shared
   * availability command model — the same source the DOM menu renders, so the
   * two menus stay in manual parity. */
  availabilityCommands?: WorkspaceAvailabilityCommand[];
  onAvailabilityCommand?: (kind: WorkspaceAvailabilityCommandKind) => void;
}

export function useWorkspaceActionsNativeMenu(input: WorkspaceActionsNativeMenuInput) {
  return useNativeMenu(() => buildWorkspaceActionsNativeMenuItems(input));
}

export function buildWorkspaceActionsNativeMenuItems(
  input: WorkspaceActionsNativeMenuInput,
): NativeMenuItem[] {
  const items: NativeMenuItem[] = [
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

  const availabilityCommands = input.availabilityCommands ?? [];
  if (availabilityCommands.length > 0) {
    items.push({ kind: "separator" });
    for (const command of availabilityCommands) {
      // An unsupported-git-state blocker is present but not actionable, mirroring
      // the disabled DOM item.
      const isBlocker = command.kind === "unsupported-git-state";
      items.push({
        id: `availability-${command.kind}`,
        label: command.blocker ? `${command.label} — ${command.blocker}` : command.label,
        enabled: !isBlocker,
        onSelect: () => {
          if (!isBlocker) input.onAvailabilityCommand?.(command.kind);
        },
      });
    }
  }

  return items;
}
