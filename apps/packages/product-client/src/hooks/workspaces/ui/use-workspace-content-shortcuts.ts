import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { getFocusZone, isRightPanelFocusZone } from "#product/lib/domain/focus-zone";
import {
  useContentSearchStore,
  type ContentSearchSurface,
} from "#product/stores/search/content-search-store";
import {
  requestRightPanelCloseActiveTab,
  requestRightPanelRelativeTab,
  requestRightPanelTabByIndex,
} from "#product/lib/workflows/workspaces/right-panel-shortcut-requests";
import type { WorkspaceTabActions } from "#product/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";

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
    const activeElement = document.activeElement;
    if (activeElement?.closest("[data-content-search-overlay]")) {
      // Focus is already in the pill: Cmd+F cycles Chat <-> Diff when review
      // search is available, rather than reopening/no-opping.
      const state = useContentSearchStore.getState();
      if (state.surfaceAvailability.review) {
        openContentSearch(state.surface === "review" ? "chat" : "review");
      }
      return true;
    }

    const surface = resolveContentSearchSurfaceForShortcut();
    if (!surface) {
      return false;
    }

    openContentSearch(surface);
    return true;
  }, { enabled });
}

function resolveContentSearchSurfaceForShortcut(): ContentSearchSurface | null {
  const activeElement = document.activeElement;
  if (activeElement?.closest("[data-file-viewer-frame]")) {
    return "file";
  }
  if (activeElement?.closest("[data-git-review-document]")) {
    return "review";
  }

  const focusZone = getFocusZone();
  if (focusZone === "right-panel") {
    if (document.querySelector("[data-file-viewer-frame]")) {
      return "file";
    }
    if (document.querySelector("[data-git-review-document]")) {
      return "review";
    }
    return null;
  }

  if (focusZone === "terminal") {
    return null;
  }

  return "chat";
}
