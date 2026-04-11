import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useFocusZone } from "@/hooks/ui/use-focus-zone";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseMainScreenShortcutsArgs {
  onOpenFilePalette: () => void;
  allowFilePalette: boolean;
}

export function useMainScreenShortcuts({
  onOpenFilePalette,
  allowFilePalette,
}: UseMainScreenShortcutsArgs): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { toggleFocus } = useFocusZone();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const enabled = selectedWorkspaceId !== null;

  useShortcutHandler("workspace.focus-toggle", () => {
    toggleFocus();
  }, { enabled });

  useShortcutHandler("workspace.open-file-palette", () => {
    const blockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    onOpenFilePalette();
  }, { enabled: enabled && allowFilePalette });
}
