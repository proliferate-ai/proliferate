import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { getFocusZone } from "@/hooks/ui/use-focus-zone";
import type { WorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";

interface WorkspaceContentShortcutActions extends Pick<
  WorkspaceTabActions,
  | "activateRelativeTab"
  | "activateTabByShortcutIndex"
  | "closeActiveWorkspaceTab"
  | "openNewSessionTab"
  | "restoreLastDismissedTab"
> {
  createNewTerminalTab?: () => void;
}

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
    createNewTerminalTab,
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
    if (createNewTerminalTab && getFocusZone() === "terminal") {
      createNewTerminalTab();
      return;
    }

    return openNewSessionTab();
  }, { enabled });

  useShortcutHandler("workspace.close-active-tab", () => {
    return closeActiveWorkspaceTab() !== "noop";
  }, { enabled });
}
