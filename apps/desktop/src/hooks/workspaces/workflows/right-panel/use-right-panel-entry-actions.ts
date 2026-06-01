import {
  useCallback,
  useState,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useNavigate } from "react-router-dom";
import { useTerminalActions } from "@/hooks/terminals/workflows/use-terminal-actions";
import {
  parseRightPanelHeaderEntryKey,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  terminalIdsFromHeaderOrder,
  viewerTargetKeysFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { createRightPanelBrowserTabId } from "@/lib/domain/workspaces/shell/right-panel-browser-tabs";
import {
  createOrActivateBrowserTabInRightPanelState,
  removeBrowserTabFromRightPanelState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  updateBrowserTabUrlInRightPanelState,
} from "@/lib/domain/workspaces/shell/right-panel-state";
import {
  reconcileRightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-state-normalization";
import {
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useToastStore } from "@/stores/toast/toast-store";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";
import { useRightPanelViewerActions } from "@/hooks/workspaces/workflows/right-panel/use-right-panel-viewer-actions";

type RightPanelStateUpdater = (value: SetStateAction<RightPanelWorkspaceState>) => void;

interface RightPanelTerminalsQuery {
  refetch: () => Promise<{ data?: readonly TerminalRecord[] | null }>;
}

interface UseRightPanelEntryActionsOptions {
  workspaceId: string | null;
  shouldRenderContent: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  repoSettingsHref: string;
  terminalsQuery: RightPanelTerminalsQuery;
  activeTerminalId: string | null;
  openViewerTargets: readonly ViewerTarget[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  updateState: RightPanelStateUpdater;
  setActiveTerminalForWorkspace: (workspaceId: string, terminalId: string | null) => void;
  closeViewerTarget: (targetKey: ViewerTargetKey) => void;
  reorderViewerTargets: (orderedTargetKeys: readonly ViewerTargetKey[]) => void;
  setActiveViewerTarget: (targetKey: ViewerTargetKey | null) => void;
  clearBuffer: (path: string) => void;
  onOpenPanel: () => void;
}

export function useRightPanelEntryActions({
  workspaceId,
  shouldRenderContent,
  isCloudWorkspaceSelected,
  state,
  repoSettingsHref,
  terminalsQuery,
  activeTerminalId,
  openViewerTargets,
  buffersByPath,
  updateState,
  setActiveTerminalForWorkspace,
  closeViewerTarget,
  reorderViewerTargets,
  setActiveViewerTarget,
  clearBuffer,
  onOpenPanel,
}: UseRightPanelEntryActionsOptions) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const navigate = useNavigate();
  const showToast = useToastStore((store) => store.show);
  const [terminalFocusNonce, setTerminalFocusNonce] = useState(0);
  const { selectViewer, handleCloseViewer } = useRightPanelViewerActions({
    state,
    isCloudWorkspaceSelected,
    openViewerTargets,
    buffersByPath,
    updateState,
    closeViewerTarget,
    setActiveViewerTarget,
    clearBuffer,
  });

  const selectTerminal = useCallback((terminalId: string) => {
    const terminalKey = rightPanelTerminalHeaderKey(terminalId);
    updateState((previous) => ({
      ...previous,
      activeEntryKey: terminalKey,
      headerOrder: previous.headerOrder.includes(terminalKey)
        ? previous.headerOrder
        : [...previous.headerOrder, terminalKey],
    }));
    if (workspaceId) {
      setActiveTerminalForWorkspace(workspaceId, terminalId);
    }
    setTerminalFocusNonce((nonce) => nonce + 1);
  }, [setActiveTerminalForWorkspace, updateState, workspaceId]);

  const createTerminal = useCallback(async (options?: { activate?: boolean }) => {
    if (!workspaceId || !shouldRenderContent) {
      return null;
    }
    const activate = options?.activate ?? true;
    try {
      const terminalId = await createTab(workspaceId, 120, 40);
      const terminalKey = rightPanelTerminalHeaderKey(terminalId);
      updateState((previous) => ({
        ...previous,
        activeEntryKey: activate ? terminalKey : previous.activeEntryKey,
        headerOrder: previous.headerOrder.includes(terminalKey)
          ? previous.headerOrder
          : [...previous.headerOrder, terminalKey],
      }));
      if (activate) {
        setTerminalFocusNonce((nonce) => nonce + 1);
      }
      return terminalId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to create terminal tab: ${message}`);
      return null;
    }
  }, [createTab, shouldRenderContent, showToast, updateState, workspaceId]);

  const activateTerminalTool = useCallback(async () => {
    setTerminalFocusNonce((nonce) => nonce + 1);

    if (!workspaceId || !shouldRenderContent) {
      return;
    }

    const result = await terminalsQuery.refetch();
    if (!result.data) {
      showToast("Failed to load terminals.");
      return;
    }
    const next = reconcileRightPanelWorkspaceState(state, {
      isCloudWorkspaceSelected,
      liveTerminals: result.data,
    });
    updateState(next);
    const records = result.data.filter((terminal) =>
      terminal.purpose !== "setup" || terminalIdsFromHeaderOrder(next.headerOrder).includes(terminal.id)
    );

    if (records.length === 0) {
      await createTerminal({ activate: true });
      return;
    }

    const activeTerminalStillExists = activeTerminalId
      ? records.some((terminal) => terminal.id === activeTerminalId)
      : false;
    selectTerminal(activeTerminalStillExists && activeTerminalId ? activeTerminalId : records[0]!.id);
  }, [
    activeTerminalId,
    createTerminal,
    isCloudWorkspaceSelected,
    selectTerminal,
    shouldRenderContent,
    showToast,
    state,
    terminalsQuery,
    updateState,
    workspaceId,
  ]);

  const activateTool = useCallback(
    (tool: RightPanelTool) => {
      updateState((previous) => ({ ...previous, activeEntryKey: rightPanelToolHeaderKey(tool) }));
    },
    [updateState],
  );

  const selectBrowser = useCallback((browserId: string) => {
    const browserKey = rightPanelBrowserHeaderKey(browserId);
    updateState((previous) => ({ ...previous, activeEntryKey: browserKey }));
  }, [updateState]);

  const activateRightPanelEntry = useCallback((entryKey: RightPanelHeaderEntryKey) => {
    const entry = parseRightPanelHeaderEntryKey(entryKey);
    if (!entry) {
      return false;
    }

    if (entry.kind === "tool") {
      activateTool(entry.tool);
      return true;
    }
    if (entry.kind === "terminal") {
      selectTerminal(entry.terminalId);
      return true;
    }
    if (entry.kind === "browser") {
      selectBrowser(entry.browserId);
      return true;
    }
    if (entry.kind === "viewer") {
      selectViewer(entry.targetKey);
      return true;
    }
    return false;
  }, [activateTool, selectBrowser, selectTerminal, selectViewer]);

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      if (!workspaceId) {
        return;
      }

      void closeTab(terminalId, workspaceId).then((result) => {
        if (result !== "closed" && result !== "missing") {
          return;
        }
        updateState((previous) =>
          removeTerminalFromRightPanelState(
            previous,
            terminalId,
            isCloudWorkspaceSelected,
          ),
        );
      });
    },
    [closeTab, isCloudWorkspaceSelected, updateState, workspaceId],
  );

  const handleRenameTerminal = useCallback(async (terminalId: string, title: string) => {
    if (!workspaceId) {
      return;
    }
    try {
      await renameTab(terminalId, workspaceId, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to rename terminal: ${message}`);
      throw error;
    }
  }, [renameTab, showToast, workspaceId]);

  const handleCreateBrowser = useCallback(() => {
    if (!workspaceId || !shouldRenderContent) {
      return false;
    }
    updateState((previous) =>
      createOrActivateBrowserTabInRightPanelState(
        previous,
        createRightPanelBrowserTabId(),
        isCloudWorkspaceSelected,
      ),
    );
    onOpenPanel();
    return true;
  }, [
    isCloudWorkspaceSelected,
    onOpenPanel,
    shouldRenderContent,
    updateState,
    workspaceId,
  ]);

  const handleCloseBrowser = useCallback((browserId: string) => {
    updateState((previous) =>
      removeBrowserTabFromRightPanelState(previous, browserId, isCloudWorkspaceSelected)
    );
  }, [isCloudWorkspaceSelected, updateState]);

  const closeActiveRightPanelEntry = useCallback(() => {
    const entry = parseRightPanelHeaderEntryKey(state.activeEntryKey);
    if (!entry) {
      return true;
    }

    if (entry.kind === "terminal") {
      handleCloseTerminal(entry.terminalId);
      return true;
    }
    if (entry.kind === "browser") {
      handleCloseBrowser(entry.browserId);
      return true;
    }
    if (entry.kind === "viewer") {
      handleCloseViewer(entry.targetKey);
      return true;
    }

    return true;
  }, [
    handleCloseBrowser,
    handleCloseTerminal,
    handleCloseViewer,
    state.activeEntryKey,
  ]);

  const handleUpdateBrowserUrl = useCallback((browserId: string, url: string) => {
    updateState((previous) =>
      updateBrowserTabUrlInRightPanelState(previous, browserId, url, isCloudWorkspaceSelected)
    );
  }, [isCloudWorkspaceSelected, updateState]);

  const handleReorderHeaderEntry = useCallback(
    (
      entryKey: RightPanelHeaderEntryKey,
      beforeEntryKey: RightPanelHeaderEntryKey | null,
    ) => {
      const next = reorderHeaderEntryInRightPanelState(
        state,
        entryKey,
        beforeEntryKey,
        isCloudWorkspaceSelected,
      );
      updateState(next);
      reorderViewerTargets(viewerTargetKeysFromHeaderOrder(next.headerOrder));
    },
    [isCloudWorkspaceSelected, reorderViewerTargets, state, updateState],
  );

  const handleCreateTerminal = useCallback(() => {
    void createTerminal({ activate: true });
  }, [createTerminal]);

  const handleOpenRepoSettings = useCallback(() => {
    navigate(repoSettingsHref);
  }, [navigate, repoSettingsHref]);

  return {
    terminalFocusNonce,
    createTerminal,
    activateTerminalTool,
    activateRightPanelEntry,
    selectTerminal,
    handleCloseTerminal,
    handleCloseBrowser,
    handleCloseViewer,
    handleRenameTerminal,
    handleCreateTerminal,
    handleCreateBrowser,
    handleOpenRepoSettings,
    handleReorderHeaderEntry,
    handleUpdateBrowserUrl,
    closeActiveRightPanelEntry,
  };
}
