import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseMainScreenShortcutsArgs {
  onOpenFilePalette: () => void;
  onOpenTerminal: () => boolean;
}

export function useMainScreenShortcuts({
  onOpenFilePalette,
  onOpenTerminal,
}: UseMainScreenShortcutsArgs): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const enabled = selectedWorkspaceId !== null;

  useShortcutHandler("workspace.focus-chat", () => {
    return focusChatInput();
  }, { enabled });

  useShortcutHandler("workspace.open-terminal", () => {
    return onOpenTerminal();
  }, { enabled });

  useShortcutHandler("workspace.open-file-palette", () => {
    const blockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    onOpenFilePalette();
  }, { enabled });
}
