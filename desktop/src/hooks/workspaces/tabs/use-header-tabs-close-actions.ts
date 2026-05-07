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
} from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  fileViewerTarget,
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";

function isStringPath(path: string | null): path is string {
  return path !== null;
}

function workspaceTabEditablePath(tab: WorkspaceShellTab): string | null {
  return tab.kind === "viewer" ? viewerTargetEditablePath(tab.target) : null;
}

export function useHeaderTabsCloseActions({
  selectedWorkspaceId,
  shellWorkspaceId,
  activeShellTab,
  orderedTabs,
  buffersByPath,
  closeTarget,
  showChatSessionTab,
  hideChatSessionTabs,
}: {
  selectedWorkspaceId: string | null;
  shellWorkspaceId?: string | null;
  activeShellTab: WorkspaceShellTab | null;
  orderedTabs: WorkspaceShellTab[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  closeTarget: (targetKey: ViewerTargetKey) => void;
  showChatSessionTab: (
    sessionId: string,
    options?: { select?: boolean },
  ) => boolean;
  hideChatSessionTabs: (
    sessionIds: string[],
    options?: { selectFallback?: boolean },
  ) => boolean;
}) {
  const { activateChatShell, activateViewerTarget } = useWorkspaceShellActivation();
  const clearBuffer = useWorkspaceFileBuffersStore((state) => state.clearBuffer);

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
    if (fallback?.kind === "viewer") {
      activateViewerTarget({
        workspaceId: selectedWorkspaceId,
        shellWorkspaceId,
        target: fallback.target,
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
    activateViewerTarget,
    orderedTabs,
    selectedWorkspaceId,
    shellWorkspaceId,
    showChatSessionTab,
  ]);

  const closeViewerTabsOnly = useCallback((tabs: WorkspaceShellTab[]) => {
    const targets = tabs
      .filter((tab): tab is Extract<WorkspaceShellTab, { kind: "viewer" }> => tab.kind === "viewer")
      .map((tab) => tab.target);
    const bufferPaths = Array.from(new Set(targets
      .map(viewerTargetEditablePath)
      .filter(isStringPath)));
    const closingKeys = new Set(tabs.map(getWorkspaceShellTabKey));
    const remainingBufferPaths = new Set(orderedTabs
      .filter((tab) => !closingKeys.has(getWorkspaceShellTabKey(tab)))
      .map(workspaceTabEditablePath)
      .filter(isStringPath));
    const discardedBufferPaths = bufferPaths
      .filter((path) => !remainingBufferPaths.has(path));
    const dirtyPaths = discardedBufferPaths
      .filter((path) => buffersByPath[path]?.isDirty);
    if (
      dirtyPaths.length > 0
      && !window.confirm("Discard unsaved changes in the selected tabs?")
    ) {
      return false;
    }
    targets.forEach((target) => closeTarget(viewerTargetKey(target)));
    discardedBufferPaths.forEach(clearBuffer);
    return true;
  }, [buffersByPath, clearBuffer, closeTarget, orderedTabs]);

  const closeFilePaths = useCallback((paths: string[]) => {
    const tabs = paths.map((path) => ({
      kind: "viewer" as const,
      target: fileViewerTarget(path),
    }));
    if (!closeViewerTabsOnly(tabs)) {
      return false;
    }
    activateFallbackAfterClosingTabs(tabs);
    return true;
  }, [activateFallbackAfterClosingTabs, closeViewerTabsOnly]);

  const closeWorkspaceTabs = useCallback((tabs: WorkspaceShellTab[]) => {
    if (!closeViewerTabsOnly(tabs)) {
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
  }, [activateFallbackAfterClosingTabs, closeViewerTabsOnly, hideChatSessionTabs]);

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
    closeWorkspaceTabs,
    closeOtherWorkspaceTabs,
    closeWorkspaceTabsToRight,
  };
}
