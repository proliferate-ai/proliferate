import { useCallback } from "react";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  resolveFallbackWorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";

export type CloseActiveWorkspaceTabResult = "closed" | "blocked" | "noop";

function discardDirtyFileTab(isDirty: boolean): boolean {
  if (!isDirty) {
    return true;
  }

  return window.confirm("Discard unsaved changes?");
}

export function useCloseActiveWorkspaceTab() {
  const buffersByPath = useWorkspaceFilesStore((state) => state.buffersByPath);
  const closeTab = useWorkspaceFilesStore((state) => state.closeTab);
  const { activateChatShell, activateFileTab } = useWorkspaceShellActivation();
  const headerTabs = useWorkspaceHeaderTabsViewModel();
  const chatVisibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: headerTabs.workspaceUiKey,
    materializedWorkspaceId: headerTabs.materializedWorkspaceId,
    visibleIds: headerTabs.visibleChatSessionIds,
    liveIds: headerTabs.liveChatSessionIds,
    childToParent: headerTabs.childToParent,
  });

  return useCallback((): CloseActiveWorkspaceTabResult => {
    const activeShellTab = headerTabs.activeShellTab;
    if (activeShellTab?.kind === "file") {
      const path = activeShellTab.path;
      const isDirty = buffersByPath[path]?.isDirty ?? false;
      if (!discardDirtyFileTab(isDirty)) {
        return "blocked";
      }

      const fallback = resolveFallbackWorkspaceShellTab({
        tabs: headerTabs.orderedTabs,
        closingTabs: [activeShellTab],
        activeTab: activeShellTab,
      });
      closeTab(path);
      if (fallback && headerTabs.selectedWorkspaceId) {
        if (fallback.kind === "chat") {
          chatVisibilityActions.showChatSessionTab(fallback.sessionId, { select: true });
        } else {
          activateFileTab({
            workspaceId: headerTabs.selectedWorkspaceId,
            shellWorkspaceId: headerTabs.workspaceUiKey,
            path: fallback.path,
            mode: "focus-existing",
          });
        }
      } else if (headerTabs.selectedWorkspaceId) {
        activateChatShell({
          workspaceId: headerTabs.selectedWorkspaceId,
          shellWorkspaceId: headerTabs.workspaceUiKey,
          reason: "close_active_tab",
        });
      }
      return "closed";
    }

    if (activeShellTab?.kind === "chat") {
      const hidden = chatVisibilityActions.hideChatSessionTabs(
        [activeShellTab.sessionId],
        { selectFallback: true },
      );
      return hidden ? "closed" : "noop";
    }

    return "noop";
  }, [
    buffersByPath,
    activateChatShell,
    activateFileTab,
    chatVisibilityActions,
    closeTab,
    headerTabs.activeShellTab,
    headerTabs.orderedTabs,
    headerTabs.selectedWorkspaceId,
    headerTabs.workspaceUiKey,
  ]);
}
