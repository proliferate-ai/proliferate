import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { getFocusZone } from "@/lib/domain/focus-zone";
import { requestRightPanelNewTabMenu } from "@/lib/infra/right-panel-new-tab-menu";
import type { WorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";

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
): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const enabled = selectedWorkspaceId !== null;
  const {
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    openNewSessionTab,
    restoreLastDismissedTab,
  } = actions;

  useShortcutHandler("workspace.previous-tab", () => {
    return activateRelativeTab(-1);
  }, { enabled });

  useShortcutHandler("workspace.next-tab", () => {
    return activateRelativeTab(1);
  }, { enabled });

  useShortcutHandler("workspace.restore-tab", () => {
    return restoreLastDismissedTab();
  }, { enabled });

  useShortcutHandler("workspace.tab-by-index", ({ digit }) => {
    if (!digit) {
      return false;
    }

    return activateTabByShortcutIndex(String(digit));
  }, { enabled });

  useShortcutHandler("workspace.new-session-tab", () => {
    const focusZone = getFocusZone();
    if (focusZone === "terminal" || focusZone === "browser") {
      return requestRightPanelNewTabMenu("terminal");
    }

    return openNewSessionTab();
  }, { enabled });

  useShortcutHandler("workspace.close-active-tab", () => {
    return closeActiveWorkspaceTab() !== "noop";
  }, { enabled });
}
