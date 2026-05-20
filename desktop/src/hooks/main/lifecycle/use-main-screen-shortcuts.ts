import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

interface UseMainScreenShortcutsArgs {
  enabled?: boolean;
  canOpenCommandPalette: boolean;
  onOpenCommandPalette: () => void;
  onOpenTerminal: () => boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightPanel: () => void;
}

// Owns Main screen shortcut registration. The callbacks are supplied by the
// workflow hook so shortcut bindings stay separate from action behavior.
export function useMainScreenShortcuts({
  enabled = true,
  canOpenCommandPalette,
  onOpenCommandPalette,
  onOpenTerminal,
  onToggleLeftSidebar,
  onToggleRightPanel,
}: UseMainScreenShortcutsArgs): void {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const canUseWorkspaceShortcuts = enabled && selectedWorkspaceId !== null;

  useShortcutHandler("workspace.focus-chat", () => {
    return focusChatInput();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-terminal", () => {
    return onOpenTerminal();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.toggle-left-sidebar", () => {
    onToggleLeftSidebar();
  }, { enabled });

  useShortcutHandler("workspace.toggle-right-panel", () => {
    onToggleRightPanel();
  }, { enabled: canUseWorkspaceShortcuts });

  useShortcutHandler("workspace.open-command-palette", () => {
    onOpenCommandPalette();
  }, { enabled: enabled && canOpenCommandPalette });
}
