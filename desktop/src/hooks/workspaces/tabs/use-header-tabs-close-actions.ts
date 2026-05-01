import { useCallback } from "react";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import {
  getWorkspaceShellTabKey,
  isSameWorkspaceShellTab,
  parseWorkspaceShellTabKey,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { resolveNextShellTabAfterClose } from "@/lib/domain/workspaces/tabs/shell-activation";
import type {
  WorkspaceFileBuffer,
} from "@/stores/editor/workspace-files-store";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";

export function useHeaderTabsCloseActions({
  selectedWorkspaceId,
  shellWorkspaceId,
  activeShellTab,
  orderedTabs,
  buffersByPath,
  closeTab,
  showChatSessionTab,
  hideChatSessionTabs,
}: {
  selectedWorkspaceId: string | null;
  shellWorkspaceId?: string | null;
  activeShellTab: WorkspaceShellTab | null;
  orderedTabs: WorkspaceShellTab[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  closeTab: (path: string) => void;
  showChatSessionTab: (
    sessionId: string,
    options?: { select?: boolean },
  ) => boolean;
  hideChatSessionTabs: (
    sessionIds: string[],
    options?: { selectFallback?: boolean },
  ) => boolean;
}) {
  const { activateChatShell, activateFileTab } = useWorkspaceShellActivation();

  const activateFallbackAfterClosingTabs = useCallback((closingTabs: WorkspaceShellTab[]) => {
    if (!selectedWorkspaceId || !activeShellTab || closingTabs.length === 0) {
      return;
    }

    const activeKey = getWorkspaceShellTabKey(activeShellTab);
    const closingKeys = closingTabs.map(getWorkspaceShellTabKey);
    if (!closingKeys.includes(activeKey)) {
      return;
    }

    const fallbackKey = resolveNextShellTabAfterClose({
      orderedTabs: orderedTabs.map(getWorkspaceShellTabKey),
      closingTabKeys: closingKeys,
      currentTabKey: activeKey,
    });
    if (!fallbackKey) {
      activateChatShell({
        workspaceId: selectedWorkspaceId,
        shellWorkspaceId,
        reason: "close_header_tab",
      });
      return;
    }

    const fallback = parseWorkspaceShellTabKey(fallbackKey);
    if (fallback?.kind === "chat") {
      showChatSessionTab(fallback.sessionId, { select: true });
      return;
    }
    if (fallback?.kind === "file") {
      activateFileTab({
        workspaceId: selectedWorkspaceId,
        shellWorkspaceId,
        path: fallback.path,
        mode: "focus-existing",
      });
      return;
    }

    activateChatShell({
      workspaceId: selectedWorkspaceId,
      shellWorkspaceId,
      reason: "close_header_tab",
    });
  }, [
    activeShellTab,
    activateChatShell,
    activateFileTab,
    orderedTabs,
    selectedWorkspaceId,
    shellWorkspaceId,
    showChatSessionTab,
  ]);

  const closeFilePathsOnly = useCallback((paths: string[]) => {
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

  const closeFilePaths = useCallback((paths: string[]) => {
    if (!closeFilePathsOnly(paths)) {
      return false;
    }
    activateFallbackAfterClosingTabs(paths.map((path) => ({ kind: "file", path })));
    return true;
  }, [activateFallbackAfterClosingTabs, closeFilePathsOnly]);

  const closeWorkspaceTabs = useCallback((tabs: WorkspaceShellTab[]) => {
    const filePaths = tabs
      .filter((tab): tab is Extract<WorkspaceShellTab, { kind: "file" }> => tab.kind === "file")
      .map((tab) => tab.path);
    if (!closeFilePathsOnly(filePaths)) {
      return false;
    }

    const chatSessionIds = tabs
      .filter((tab): tab is Extract<WorkspaceShellTab, { kind: "chat" }> => tab.kind === "chat")
      .map((tab) => tab.sessionId);
    if (chatSessionIds.length > 0) {
      const hidden = hideChatSessionTabs(chatSessionIds, { selectFallback: false });
      if (!hidden) {
        return false;
      }
    }
    activateFallbackAfterClosingTabs(tabs);
    return true;
  }, [activateFallbackAfterClosingTabs, closeFilePathsOnly, hideChatSessionTabs]);

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
