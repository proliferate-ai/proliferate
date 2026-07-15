import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { getFocusZone, isRightPanelFocusZone } from "@/lib/domain/focus-zone";
import { useContentSearchStore } from "@/stores/search/content-search-store";
import {
  requestRightPanelCloseActiveTab,
  requestRightPanelRelativeTab,
  requestRightPanelTabByIndex,
} from "@/lib/workflows/workspaces/right-panel-shortcut-requests";
import type { WorkspaceTabActions } from "@/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";

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
  const openContentSearch = useContentSearchStore((state) => state.openSearch);
  const enabled = options.enabled ?? true;
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
    if (isRightPanelFocusZone(getFocusZone())) {
      const handled = requestRightPanelCloseActiveTab();
      if (handled) {
        return true;
      }
    }

    return closeActiveWorkspaceTab() !== "noop";
  }, { enabled });

  useShortcutHandler("workspace.find-content", () => {
    const surface = resolveContentSearchSurfaceForShortcut();
    if (!surface) {
      return false;
    }

    openContentSearch("diffs", surface);
    return true;
  }, { enabled });
}

function resolveContentSearchSurfaceForShortcut(): "chat" | "file" | null {
  const activeElement = document.activeElement;
  if (activeElement?.closest("[data-file-viewer-frame]")) {
    return "file";
  }

  const focusZone = getFocusZone();
  if (focusZone === "right-panel") {
    return document.querySelector("[data-file-viewer-frame]") ? "file" : null;
  }

  if (focusZone === "terminal") {
    return null;
  }

  return "chat";
}
