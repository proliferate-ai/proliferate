import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { useHarnessStore } from "@/stores/sessions/harness-store";

interface UseMainScreenShortcutsArgs {
  canOpenCommandPalette: boolean;
  onOpenCommandPalette: () => void;
  onOpenTerminal: () => boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightPanel: () => void;
}

export function useMainScreenShortcuts({
  canOpenCommandPalette,
  onOpenCommandPalette,
  onOpenTerminal,
  onToggleLeftSidebar,
  onToggleRightPanel,
}: UseMainScreenShortcutsArgs): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const canUseWorkspaceShortcuts = selectedWorkspaceId !== null;

  useShortcutHandler("workspace.focus-chat", () => {
    return focusChatInput();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-terminal", () => {
    return onOpenTerminal();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.toggle-left-sidebar", () => {
    onToggleLeftSidebar();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.toggle-right-panel", () => {
    onToggleRightPanel();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-command-palette", () => {
    onOpenCommandPalette();
  }, { enabled: canOpenCommandPalette });
}
