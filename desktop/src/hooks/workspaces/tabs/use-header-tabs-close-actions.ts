import { useCallback } from "react";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import {
  isSameWorkspaceShellTab,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type {
  WorkspaceFileBuffer,
} from "@/stores/editor/workspace-files-store";

export function useHeaderTabsCloseActions({
  activeShellTab,
  orderedTabs,
  buffersByPath,
  closeTab,
  hideChatSessionTabs,
}: {
  activeShellTab: WorkspaceShellTab | null;
  orderedTabs: WorkspaceShellTab[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  closeTab: (path: string) => void;
  hideChatSessionTabs: (
    sessionIds: string[],
    options?: { selectFallback?: boolean },
  ) => boolean;
}) {
  const closeFilePaths = useCallback((paths: string[]) => {
    const dirtyPaths = paths.filter((path) => buffersByPath[path]?.isDirty);
    if (
      dirtyPaths.length > 0
      && !window.confirm("Discard unsaved changes in the selected tabs?")
    ) {
      return false;
    }
    paths.forEach((path) => closeTab(path));
    return true;
  }, [buffersByPath, closeTab]);

  const closeWorkspaceTabs = useCallback((tabs: WorkspaceShellTab[]) => {
    const filePaths = tabs
      .filter((tab): tab is Extract<WorkspaceShellTab, { kind: "file" }> => tab.kind === "file")
      .map((tab) => tab.path);
    if (!closeFilePaths(filePaths)) {
      return false;
    }

    const chatSessionIds = tabs
      .filter((tab): tab is Extract<WorkspaceShellTab, { kind: "chat" }> => tab.kind === "chat")
      .map((tab) => tab.sessionId);
    if (chatSessionIds.length > 0) {
      return hideChatSessionTabs(chatSessionIds, { selectFallback: true });
    }
    return true;
  }, [closeFilePaths, hideChatSessionTabs]);

  const closeOtherWorkspaceTabs = useCallback((anchorTab: WorkspaceShellTab) => {
    return closeWorkspaceTabs(
      orderedTabs.filter((tab) => !isSameWorkspaceShellTab(tab, anchorTab)),
    );
  }, [closeWorkspaceTabs, orderedTabs]);

  const closeWorkspaceTabsToRight = useCallback((anchorTab: WorkspaceShellTab) => {
    const index = orderedTabs.findIndex((tab) =>
      isSameWorkspaceShellTab(tab, anchorTab)
    );
    if (index < 0) {
      return false;
    }
    return closeWorkspaceTabs(orderedTabs.slice(index + 1));
  }, [closeWorkspaceTabs, orderedTabs]);

  useShortcutHandler("workspace.close-other-tabs", () => {
    if (!activeShellTab) {
      return false;
    }

    return closeOtherWorkspaceTabs(activeShellTab);
  });

  useShortcutHandler("workspace.close-tabs-to-right", () => {
    if (!activeShellTab) {
      return false;
    }

    return closeWorkspaceTabsToRight(activeShellTab);
  });

  return {
    closeFilePaths,
    closeOtherWorkspaceTabs,
    closeWorkspaceTabsToRight,
  };
}
