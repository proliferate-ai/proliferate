import { useCallback } from "react";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  resolveFallbackWorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
} from "@/lib/domain/workspaces/viewer-target";
import type { WorkspaceTabActionsContext } from "@/hooks/workspaces/use-workspace-tab-actions";

export type CloseActiveWorkspaceTabResult = "closed" | "blocked" | "noop";

function discardDirtyFileTab(isDirty: boolean): boolean {
  if (!isDirty) {
    return true;
  }

  return window.confirm("Discard unsaved changes?");
}

export function useCloseActiveWorkspaceTab(headerTabs: WorkspaceTabActionsContext) {
  const buffersByPath = useWorkspaceFileBuffersStore((state) => state.buffersByPath);
  const clearBuffer = useWorkspaceFileBuffersStore((state) => state.clearBuffer);
  const closeTarget = useWorkspaceViewerTabsStore((state) => state.closeTarget);
  const { activateChatShell, activateViewerTarget } = useWorkspaceShellActivation();
  const chatVisibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: headerTabs.workspaceUiKey,
    materializedWorkspaceId: headerTabs.materializedWorkspaceId,
    visibleIds: headerTabs.visibleChatSessionIds,
    liveIds: headerTabs.liveChatSessionIds,
    childToParent: headerTabs.childToParent,
  });

  return useCallback((): CloseActiveWorkspaceTabResult => {
    const activeShellTab = headerTabs.activeShellTab;
    if (activeShellTab?.kind === "viewer") {
      const bufferPath = viewerTargetEditablePath(activeShellTab.target);
      const activeTargetKey = viewerTargetKey(activeShellTab.target);
      const shouldClearBuffer = bufferPath
        ? !headerTabs.orderedTabs.some((tab) =>
            tab.kind === "viewer"
            && viewerTargetKey(tab.target) !== activeTargetKey
            && viewerTargetEditablePath(tab.target) === bufferPath
          )
        : false;
      const isDirty = shouldClearBuffer && bufferPath
        ? buffersByPath[bufferPath]?.isDirty ?? false
        : false;
      if (!discardDirtyFileTab(isDirty)) {
        return "blocked";
      }

      const fallback = resolveFallbackWorkspaceShellTab({
        tabs: headerTabs.orderedTabs,
        closingTabs: [activeShellTab],
        activeTab: activeShellTab,
      });
      closeTarget(activeTargetKey);
      if (bufferPath && shouldClearBuffer) {
        clearBuffer(bufferPath);
      }
      if (fallback && headerTabs.selectedWorkspaceId) {
        if (fallback.kind === "chat") {
          chatVisibilityActions.showChatSessionTab(fallback.sessionId, { select: true });
        } else {
          activateViewerTarget({
            workspaceId: headerTabs.selectedWorkspaceId,
            shellWorkspaceId: headerTabs.workspaceUiKey,
            target: fallback.target,
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
    activateViewerTarget,
    chatVisibilityActions,
    clearBuffer,
    closeTarget,
    headerTabs.activeShellTab,
    headerTabs.orderedTabs,
    headerTabs.selectedWorkspaceId,
    headerTabs.workspaceUiKey,
  ]);
}
