import { useEffect } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { SHORTCUTS } from "@/config/shortcuts";
import { useFocusZone } from "@/hooks/ui/use-focus-zone";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";

/**
 * Workspace-scoped shortcuts that don't fit in tab navigation:
 * - Cmd+L: toggle focus between chat and terminal
 * - Cmd+R: rename active session
 */
interface UseWorkspaceShortcutsArgs {
  onOpenFilePalette: () => void;
}

export function useWorkspaceShortcuts({
  onOpenFilePalette,
}: UseWorkspaceShortcutsArgs): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { toggleFocus } = useFocusZone();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return undefined;
    }

    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === SHORTCUTS.focusToggle.key) {
        e.preventDefault();
        toggleFocus();
        return;
      }

      if (key === SHORTCUTS.openFilePalette.key) {
        e.preventDefault();
        const blockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
        if (blockedReason) {
          showToast(blockedReason);
          return;
        }
        onOpenFilePalette();
        return;
      }

      if (key === SHORTCUTS.renameChat.key) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("shortcut:rename-session"));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    getWorkspaceRuntimeBlockReason,
    onOpenFilePalette,
    selectedWorkspaceId,
    showToast,
    toggleFocus,
  ]);
}
