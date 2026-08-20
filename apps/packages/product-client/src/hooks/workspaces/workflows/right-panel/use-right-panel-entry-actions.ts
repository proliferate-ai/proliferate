import {
  useCallback,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalActions } from "#product/hooks/terminals/workflows/use-terminal-actions";
import {
  parseRightPanelHeaderEntryKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  terminalIdsFromHeaderOrder,
  viewerTargetKeysFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
} from "#product/lib/domain/workspaces/shell/right-panel-state";
import {
  reconcileRightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import {
  type ViewerTarget,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useToastStore } from "#product/stores/toast/toast-store";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import type { WorkspaceFileBuffer } from "#product/stores/editor/workspace-file-buffers-store";
import { useRightPanelViewerActions } from "#product/hooks/workspaces/workflows/right-panel/use-right-panel-viewer-actions";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { isWorkspaceArchivedRefusal } from "#product/lib/domain/workspaces/archived/workspace-archived-refusal";

type RightPanelStateUpdater = (value: SetStateAction<RightPanelWorkspaceState>) => void;

interface RightPanelTerminalsQuery {
  refetch: () => Promise<{ data?: readonly TerminalRecord[] | null }>;
}

interface UseRightPanelEntryActionsOptions {
  workspaceId: string | null;
  shellWorkspaceId: string | null;
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
}

export function useRightPanelEntryActions({
  workspaceId,
  shellWorkspaceId,
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
}: UseRightPanelEntryActionsOptions) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const showToast = useToastStore((store) => store.show);
  const showErrorToast = useToastStore((store) => store.showError);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeUrl = useHarnessConnectionStore((store) => store.runtimeUrl);
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const [terminalFocusNonce, setTerminalFocusNonce] = useState(0);
  const activationApplicationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { selectViewer, handleCloseViewer } = useRightPanelViewerActions({
    workspaceId,
    shellWorkspaceId,
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

  const createTerminal = useCallback(async function createTerminal(
    options?: { activate?: boolean },
  ) {
    if (!workspaceId || !shouldRenderContent) {
      return null;
    }
    // Local workspaces only block when the checkout directory is missing; a
    // shell cannot spawn there, so refuse before the runtime call fails.
    const blockReason = !isCloudWorkspaceSelected
      ? getWorkspaceRuntimeBlockReason(workspaceId)
      : null;
    if (blockReason) {
      showToast(blockReason);
      return null;
    }
    const activate = options?.activate ?? true;
    // Launch every creation immediately, but apply activating results in click
    // order so reverse promise resolution cannot give an older click final
    // ownership of selection or focus.
    const creationResult = createTab(workspaceId).then(
      (terminalId) => ({ status: "created" as const, terminalId }),
      (error: unknown) => ({ status: "failed" as const, error }),
    );
    const applyCreation = async () => {
      try {
        const result = await creationResult;
        if (result.status === "failed") {
          throw result.error;
        }
        const terminalKey = rightPanelTerminalHeaderKey(result.terminalId);
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
        return result.terminalId;
      } catch (error) {
        // WORKSPACE_ARCHIVED (§3.11): the server is correct, only the client
        // was stale — refresh the listing and raise no failure toast.
        if (isWorkspaceArchivedRefusal(error)) {
          void invalidateWorkspaceCollections();
          return null;
        }
        showErrorToast({
          headline: "Terminal not opened",
          consequence: "No new tab was added to the panel.",
          cause: error instanceof Error ? error.message : String(error),
          retry: () => void createTerminal(options),
        });
        return null;
      }
    };

    if (!activate) {
      return applyCreation();
    }
    const activationResult = activationApplicationQueueRef.current.then(applyCreation);
    activationApplicationQueueRef.current = activationResult.then(
      () => undefined,
      () => undefined,
    );
    return activationResult;
  }, [
    createTab,
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceCollections,
    isCloudWorkspaceSelected,
    shouldRenderContent,
    showErrorToast,
    showToast,
    updateState,
    workspaceId,
  ]);

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
    if (entry.kind === "viewer") {
      selectViewer(entry.targetKey);
      return true;
    }
    return false;
  }, [activateTool, selectTerminal, selectViewer]);

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

  const handleRenameTerminal = useCallback(async function handleRenameTerminal(
    terminalId: string,
    title: string,
  ) {
    if (!workspaceId) {
      return;
    }
    try {
      await renameTab(terminalId, workspaceId, title);
    } catch (error) {
      // The tab label reverts on the rethrow below, so the consequence names
      // the name the user typed: it is the thing that just disappeared.
      showErrorToast({
        headline: "Terminal not renamed",
        consequence: `The tab is still under its previous name, not "${title}".`,
        cause: error instanceof Error ? error.message : String(error),
        retry: () => void handleRenameTerminal(terminalId, title),
      });
      throw error;
    }
  }, [renameTab, showErrorToast, workspaceId]);

  const closeActiveRightPanelEntry = useCallback(() => {
    const entry = parseRightPanelHeaderEntryKey(state.activeEntryKey);
    if (!entry) {
      return true;
    }

    if (entry.kind === "terminal") {
      handleCloseTerminal(entry.terminalId);
      return true;
    }
    if (entry.kind === "viewer") {
      handleCloseViewer(entry.targetKey);
      return true;
    }

    return true;
  }, [
    handleCloseTerminal,
    handleCloseViewer,
    state.activeEntryKey,
  ]);

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

  // navigateApp instead of useNavigate: callback-only, so the right panel is
  // not subscribed to every location change (PRO-170, PRO-182).
  const handleOpenRepoSettings = useCallback(() => {
    navigateApp(repoSettingsHref);
  }, [repoSettingsHref]);

  return {
    terminalFocusNonce,
    createTerminal,
    activateTerminalTool,
    activateRightPanelEntry,
    selectTerminal,
    handleCloseTerminal,
    handleCloseViewer,
    handleRenameTerminal,
    handleCreateTerminal,
    handleOpenRepoSettings,
    handleReorderHeaderEntry,
    closeActiveRightPanelEntry,
  };
}
