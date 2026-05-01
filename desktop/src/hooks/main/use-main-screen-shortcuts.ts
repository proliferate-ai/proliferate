import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { useHarnessStore } from "@/stores/sessions/harness-store";

interface UseMainScreenShortcutsArgs {
  canOpenCommandPalette: boolean;
  onOpenCommandPalette: () => void;
  onOpenTerminal: () => boolean;
}

export function useMainScreenShortcuts({
  canOpenCommandPalette,
  onOpenCommandPalette,
  onOpenTerminal,
}: UseMainScreenShortcutsArgs): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const canUseWorkspaceShortcuts = selectedWorkspaceId !== null;

  useShortcutHandler("workspace.focus-chat", () => {
    return focusChatInput();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-terminal", () => {
    return onOpenTerminal();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-command-palette", () => {
    onOpenCommandPalette();
  }, { enabled: canOpenCommandPalette });
}
