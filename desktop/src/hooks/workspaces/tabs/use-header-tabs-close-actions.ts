import { useCallback } from "react";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { resolveChatTabContextMenuSessionIds } from "@/lib/domain/workspaces/tabs/context-menu";
import type {
  MainTab,
  WorkspaceFileBuffer,
} from "@/stores/editor/workspace-files-store";

export function useHeaderTabsCloseActions({
  activeMainTab,
  activeSessionId,
  openTabs,
  stripChatSessionIds,
  buffersByPath,
  closeTab,
  hideChatSessionTabs,
  clearSelection,
}: {
  activeMainTab: MainTab;
  activeSessionId: string | null;
  openTabs: string[];
  stripChatSessionIds: string[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  closeTab: (path: string) => void;
  hideChatSessionTabs: (
    sessionIds: string[],
    options?: { selectFallback?: boolean },
  ) => boolean;
  clearSelection: () => void;
}) {
  const closeRenderedChatTabsToRight = useCallback((anchorSessionId: string) => {
    const idsToClose = resolveChatTabContextMenuSessionIds(
      stripChatSessionIds,
      anchorSessionId,
      "close-right",
    );
    if (idsToClose.length === 0) {
      return true;
    }
    clearSelection();
    return hideChatSessionTabs(idsToClose, { selectFallback: true });
  }, [clearSelection, hideChatSessionTabs, stripChatSessionIds]);

  const closeOtherRenderedChatTabs = useCallback((anchorSessionId: string) => {
    const idsToClose = resolveChatTabContextMenuSessionIds(
      stripChatSessionIds,
      anchorSessionId,
      "close-others",
    );
    if (idsToClose.length === 0) {
      return true;
    }
    clearSelection();
    return hideChatSessionTabs(idsToClose, { selectFallback: true });
  }, [clearSelection, hideChatSessionTabs, stripChatSessionIds]);

  const closeFilePaths = useCallback((paths: string[]) => {
    const dirtyPaths = paths.filter((path) => buffersByPath[path]?.isDirty);
    if (
      dirtyPaths.length > 0
      && !window.confirm("Discard unsaved changes in the selected tabs?")
    ) {
      return;
    }
    paths.forEach((path) => closeTab(path));
  }, [buffersByPath, closeTab]);

  useShortcutHandler("workspace.close-other-tabs", () => {
    if (activeMainTab.kind === "file") {
      closeFilePaths(openTabs.filter((path) => path !== activeMainTab.path));
      return true;
    }

    if (!activeSessionId) {
      return false;
    }

    return closeOtherRenderedChatTabs(activeSessionId);
  });

  useShortcutHandler("workspace.close-tabs-to-right", () => {
    if (activeMainTab.kind === "file") {
      const index = openTabs.indexOf(activeMainTab.path);
      if (index < 0) {
        return false;
      }
      closeFilePaths(openTabs.slice(index + 1));
      return true;
    }

    if (!activeSessionId) {
      return false;
    }

    return closeRenderedChatTabsToRight(activeSessionId);
  });

  return {
    closeFilePaths,
    closeOtherRenderedChatTabs,
    closeRenderedChatTabsToRight,
  };
}
