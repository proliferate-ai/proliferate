import { useCallback } from "react";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import {
  fileWorkspaceShellTabKey,
  getWorkspaceShellTabKey,
  resolveFallbackWorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceTabsStore } from "@/stores/workspaces/workspace-tabs-store";

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
  const setActiveFileTab = useWorkspaceFilesStore((state) => state.setActiveTab);
  const setActiveShellTabKey = useWorkspaceTabsStore((state) => state.setActiveShellTabKey);
  const headerTabs = useWorkspaceHeaderTabsViewModel();
  const chatVisibilityActions = useChatTabVisibilityActions({
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
          setActiveFileTab(fallback.path);
          setActiveShellTabKey(
            headerTabs.selectedWorkspaceId,
            fileWorkspaceShellTabKey(fallback.path),
          );
        }
      } else if (headerTabs.selectedWorkspaceId) {
        setActiveShellTabKey(headerTabs.selectedWorkspaceId, null);
      }
      return "closed";
    }

    if (activeShellTab?.kind === "chat") {
      const hidden = chatVisibilityActions.hideChatSessionTabs(
        [activeShellTab.sessionId],
        { selectFallback: true },
      );
      if (!hidden && headerTabs.selectedWorkspaceId) {
        setActiveShellTabKey(
          headerTabs.selectedWorkspaceId,
          getWorkspaceShellTabKey(activeShellTab),
        );
      }
      return hidden ? "closed" : "noop";
    }

    return "noop";
  }, [
    buffersByPath,
    chatVisibilityActions,
    closeTab,
    headerTabs.activeShellTab,
    headerTabs.orderedTabs,
    headerTabs.selectedWorkspaceId,
    setActiveFileTab,
    setActiveShellTabKey,
  ]);
}
