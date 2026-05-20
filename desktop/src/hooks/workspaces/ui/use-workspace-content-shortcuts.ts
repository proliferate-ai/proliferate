import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { getFocusZone, isRightPanelFocusZone } from "@/lib/domain/focus-zone";
import {
  requestRightPanelRelativeTab,
  requestRightPanelTabByIndex,
} from "@/lib/infra/right-panel-shortcuts";
import type { WorkspaceTabActions } from "@/hooks/workspaces/tabs/use-workspace-tab-actions";

type WorkspaceContentShortcutActions = Pick<
  WorkspaceTabActions,
  | "activateRelativeTab"
  | "activateTabByShortcutIndex"
  | "closeActiveWorkspaceTab"
  | "openNewSessionTab"
  | "restoreLastDismissedTab"
>;

export function useWorkspaceContentShortcuts(
  actions: WorkspaceContentShortcutActions,
  options: { enabled?: boolean } = {},
): void {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const enabled = (options.enabled ?? true) && selectedWorkspaceId !== null;
  const {
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    openNewSessionTab,
    restoreLastDismissedTab,
  } = actions;

  useShortcutHandler("workspace.previous-tab", () => {
    if (isRightPanelFocusZone(getFocusZone())) {
      const handled = requestRightPanelRelativeTab(-1);
      if (handled) {
        return true;
      }
    }

    return activateRelativeTab(-1);
  }, { enabled });

  useShortcutHandler("workspace.next-tab", () => {
    if (isRightPanelFocusZone(getFocusZone())) {
      const handled = requestRightPanelRelativeTab(1);
      if (handled) {
        return true;
      }
    }

    return activateRelativeTab(1);
  }, { enabled });

  useShortcutHandler("workspace.restore-tab", () => {
    return restoreLastDismissedTab();
  }, { enabled });

  useShortcutHandler("workspace.tab-by-index", ({ digit }) => {
    if (!digit) {
      return false;
    }

    if (isRightPanelFocusZone(getFocusZone())) {
      const handled = requestRightPanelTabByIndex(digit);
      if (handled) {
        return true;
      }
    }

    return activateTabByShortcutIndex(String(digit));
  }, { enabled });

  useShortcutHandler("workspace.new-session-tab", () => {
    return openNewSessionTab();
  }, { enabled });

  useShortcutHandler("workspace.close-active-tab", () => {
    return closeActiveWorkspaceTab() !== "noop";
  }, { enabled });
}
