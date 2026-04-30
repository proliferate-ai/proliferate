import { useCallback } from "react";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";

export type CloseActiveWorkspaceTabResult = "closed" | "blocked" | "noop";

function discardDirtyFileTab(isDirty: boolean): boolean {
  if (!isDirty) {
    return true;
  }

  return window.confirm("Discard unsaved changes?");
}

export function useCloseActiveWorkspaceTab() {
  const activeMainTab = useWorkspaceFilesStore((state) => state.activeMainTab);
  const buffersByPath = useWorkspaceFilesStore((state) => state.buffersByPath);
  const closeTab = useWorkspaceFilesStore((state) => state.closeTab);
  const headerTabs = useWorkspaceHeaderTabsViewModel();
  const chatVisibilityActions = useChatTabVisibilityActions({
    visibleIds: headerTabs.visibleChatSessionIds,
    liveIds: headerTabs.liveChatSessionIds,
    childToParent: headerTabs.childToParent,
  });

  return useCallback((): CloseActiveWorkspaceTabResult => {
    if (activeMainTab.kind === "file") {
      const path = activeMainTab.path;
      const isDirty = buffersByPath[path]?.isDirty ?? false;
      if (!discardDirtyFileTab(isDirty)) {
        return "blocked";
      }

      closeTab(path);
      return "closed";
    }

    if (headerTabs.activeSessionId) {
      const hidden = chatVisibilityActions.hideChatSessionTabs(
        [headerTabs.activeSessionId],
        { selectFallback: true },
      );
      return hidden ? "closed" : "noop";
    }

    return "noop";
  }, [
    activeMainTab,
    buffersByPath,
    chatVisibilityActions,
    closeTab,
    headerTabs.activeSessionId,
  ]);
}
