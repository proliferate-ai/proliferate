import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useNavigate } from "react-router-dom";
import { RightPanelFrame } from "@/components/workspace/shell/right-panel/RightPanelFrame";
import { useTerminalActions } from "@/hooks/terminals/workflows/use-terminal-actions";
import { useRightPanelHeaderEntries } from "@/hooks/workspaces/derived/use-right-panel-header-entries";
import { useRightPanelRootFocus } from "@/hooks/workspaces/ui/use-right-panel-root-focus";
import { useRightPanelStateUpdater } from "@/hooks/workspaces/ui/use-right-panel-state-updater";
import {
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  parseRightPanelHeaderEntryKey,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  viewerTargetKeysFromHeaderOrder,
  terminalIdsFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { createRightPanelBrowserTabId } from "@/lib/domain/workspaces/shell/right-panel-browser-tabs";
import {
  createBrowserTabInRightPanelState,
  reconcileRightPanelWorkspaceState,
  removeBrowserTabFromRightPanelState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  updateBrowserTabUrlInRightPanelState,
} from "@/lib/domain/workspaces/shell/right-panel-state";
import {
  rightPanelStateEqual,
} from "@/lib/domain/workspaces/shell/right-panel-view";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  RIGHT_PANEL_NEW_TAB_MENU_EVENT,
  rightPanelNewTabMenuDefaultFromEvent,
  type RightPanelNewTabMenuDefault,
} from "@/lib/infra/right-panel-new-tab-menu";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

const EMPTY_TERMINALS: never[] = [];

interface TerminalActivationRequest {
  token: number;
  workspaceId: string;
}

interface RightPanelProps {
  workspaceId: string | null;
  isWorkspaceReady: boolean;
  isOpen: boolean;
  shouldKeepContentVisible?: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  repoSettingsHref: string;
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  terminalActivationRequest: TerminalActivationRequest | null;
  focusRequestToken?: number;
  nativeOverlaysHidden?: boolean;
  onTogglePanel: () => void;
  onTerminalActivationRequestHandled: (request: TerminalActivationRequest) => void;
}

export const RightPanel = memo(function RightPanel({
  workspaceId,
  isWorkspaceReady,
  isOpen,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  state,
  repoSettingsHref,
  onStateChange,
  terminalActivationRequest,
  focusRequestToken = 0,
  nativeOverlaysHidden = false,
  onTogglePanel,
  onTerminalActivationRequestHandled,
}: RightPanelProps) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const navigate = useNavigate();
  const setActiveTerminalForWorkspace = useTerminalStore(
    (store) => store.setActiveTerminalForWorkspace,
  );
  const unreadByTerminal = useTerminalStore((store) => store.unreadByTerminal);
  const showToast = useToastStore((store) => store.show);
  const openViewerTargets = useWorkspaceViewerTabsStore((store) => store.openTargets);
  const closeViewerTarget = useWorkspaceViewerTabsStore((store) => store.closeTarget);
  const reorderViewerTargets = useWorkspaceViewerTabsStore((store) => store.reorderOpenTargets);
  const setActiveViewerTarget = useWorkspaceViewerTabsStore((store) => store.setActiveTarget);
  const tabModes = useWorkspaceViewerTabsStore((store) => store.modeByTargetKey);
  const buffersByPath = useWorkspaceFileBuffersStore((store) => store.buffersByPath);
  const clearBuffer = useWorkspaceFileBuffersStore((store) => store.clearBuffer);
  const [terminalFocusNonce, setTerminalFocusNonce] = useState(0);
  const [newTabMenuRequest, setNewTabMenuRequest] = useState<{
    token: number;
    defaultKind: RightPanelNewTabMenuDefault;
  }>({ token: 0, defaultKind: "terminal" });
  const rootRef = useRef<HTMLDivElement>(null);
  const handledActivationRequestRef = useRef<string | null>(null);
  // One-shot per mounted shell: users who close the starter terminal should not
  // get a replacement every time they revisit the workspace in the same session.
  const autoTerminalWorkspaceIdsRef = useRef(new Set<string>());
  const shouldRenderContent = isWorkspaceReady || shouldKeepContentVisible;
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && shouldRenderContent),
  });
  const terminals = terminalsQuery.data ?? EMPTY_TERMINALS;
  const {
    activeTool,
    activeTerminalId,
    activeBrowserId,
    activeViewerTarget,
    visibleTerminals,
    orderedTerminals,
    browserTabs,
    canCreateBrowserTab,
    headerEntries,
  } = useRightPanelHeaderEntries({
    state,
    terminals,
    openViewerTargets,
    isCloudWorkspaceSelected,
  });
  const terminalActivationRequestToken = terminalActivationRequest?.workspaceId === workspaceId
    ? terminalActivationRequest.token
    : 0;
  const updateState = useRightPanelStateUpdater({
    isCloudWorkspaceSelected,
    liveViewerTargets: openViewerTargets,
    onStateChange,
  });

  useEffect(() => {
    const next = reconcileRightPanelWorkspaceState(state, {
      isCloudWorkspaceSelected,
      liveTerminals: terminalsQuery.isSuccess ? terminals : undefined,
      liveViewerTargets: openViewerTargets,
    });
    if (rightPanelStateEqual(state, next)) {
      return;
    }
    updateState(next);
  }, [
    isCloudWorkspaceSelected,
    openViewerTargets,
    state,
    terminals,
    terminalsQuery.isSuccess,
    updateState,
  ]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    setActiveTerminalForWorkspace(workspaceId, activeTerminalId);
  }, [
    activeTerminalId,
    setActiveTerminalForWorkspace,
    workspaceId,
  ]);

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

  useEffect(() => {
    const handleNewTabMenuRequest = (event: Event) => {
      setNewTabMenuRequest((current) => ({
        token: current.token + 1,
        defaultKind: rightPanelNewTabMenuDefaultFromEvent(event),
      }));
    };

    window.addEventListener(RIGHT_PANEL_NEW_TAB_MENU_EVENT, handleNewTabMenuRequest);
    return () => {
      window.removeEventListener(RIGHT_PANEL_NEW_TAB_MENU_EVENT, handleNewTabMenuRequest);
    };
  }, []);

  useEffect(() => {
    if (
      !workspaceId
      || !isOpen
      || !shouldRenderContent
      || !terminalsQuery.isSuccess
      || autoTerminalWorkspaceIdsRef.current.has(workspaceId)
    ) {
      return;
    }

    autoTerminalWorkspaceIdsRef.current.add(workspaceId);
    if (visibleTerminals.length > 0) {
      return;
    }

    void createTerminal({ activate: false });
  }, [
    createTerminal,
    isOpen,
    shouldRenderContent,
    terminalsQuery.isSuccess,
    visibleTerminals.length,
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

  useEffect(() => {
    const activationRequestKey = terminalActivationRequest
      ? `${terminalActivationRequest.workspaceId}:${terminalActivationRequest.token}`
      : null;
    if (
      !terminalActivationRequest
      || terminalActivationRequest.workspaceId !== workspaceId
      || handledActivationRequestRef.current === activationRequestKey
    ) {
      return;
    }
    if (!workspaceId || !shouldRenderContent) {
      return;
    }
    handledActivationRequestRef.current = activationRequestKey;
    onTerminalActivationRequestHandled(terminalActivationRequest);
    void activateTerminalTool();
  }, [
    activateTerminalTool,
    onTerminalActivationRequestHandled,
    shouldRenderContent,
    terminalActivationRequest,
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

  const selectViewer = useCallback((targetKey: RightPanelHeaderEntryKey) => {
    const target = openViewerTargets.find((candidate) =>
      viewerTargetKey(candidate) === targetKey
    );
    if (!target || target.kind === "allChanges") {
      return;
    }
    setActiveViewerTarget(targetKey as ViewerTargetKey);
    updateState((previous) => ({
      ...previous,
      activeEntryKey: targetKey,
      headerOrder: previous.headerOrder.includes(targetKey)
        ? previous.headerOrder
        : [...previous.headerOrder, targetKey],
    }));
  }, [openViewerTargets, setActiveViewerTarget, updateState]);

  const activateHeaderEntry = useCallback(
    (entry: RightPanelHeaderEntry) => {
      if (entry.kind === "tool") {
        activateTool(entry.tool);
        return;
      }
      if (entry.kind === "terminal") {
        selectTerminal(entry.terminalId);
        return;
      }
      if (entry.kind === "viewer") {
        selectViewer(entry.key);
        return;
      }
      selectBrowser(entry.tab.id);
    },
    [activateTool, selectBrowser, selectTerminal, selectViewer],
  );

  const handleRootPointerDownCapture = useRightPanelRootFocus({
    rootRef,
    isOpen,
    focusRequestToken,
    headerEntries,
    onActivateHeaderEntry: activateHeaderEntry,
  });

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
      return;
    }
    if (!canCreateBrowserTab) {
      showToast(`Maximum ${RIGHT_PANEL_BROWSER_TAB_LIMIT} browser tabs. Close one to open another.`);
      return;
    }
    updateState((previous) =>
      createBrowserTabInRightPanelState(
        previous,
        createRightPanelBrowserTabId(),
        isCloudWorkspaceSelected,
      ),
    );
  }, [
    canCreateBrowserTab,
    isCloudWorkspaceSelected,
    shouldRenderContent,
    showToast,
    updateState,
    workspaceId,
  ]);

  const handleCloseBrowser = useCallback((browserId: string) => {
    updateState((previous) =>
      removeBrowserTabFromRightPanelState(previous, browserId, isCloudWorkspaceSelected)
    );
  }, [isCloudWorkspaceSelected, updateState]);

  const handleCloseViewer = useCallback((targetKey: RightPanelHeaderEntryKey) => {
    const target = openViewerTargets.find((candidate) =>
      viewerTargetKey(candidate) === targetKey
    );
    if (!target || target.kind === "allChanges") {
      return;
    }

    const editablePath = viewerTargetEditablePath(target);
    const isLastTargetForPath = editablePath
      ? !openViewerTargets.some((candidate) =>
        viewerTargetKey(candidate) !== targetKey
        && viewerTargetEditablePath(candidate) === editablePath
      )
      : false;
    const isDirty = editablePath && isLastTargetForPath
      ? buffersByPath[editablePath]?.isDirty ?? false
      : false;
    if (isDirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }

    closeViewerTarget(targetKey as ViewerTargetKey);
    if (editablePath && isLastTargetForPath) {
      clearBuffer(editablePath);
    }
    const removedIndex = state.headerOrder.indexOf(targetKey);
    const nextHeaderOrder = state.headerOrder.filter((key) => key !== targetKey);
    const nextFallbackEntryKey = removedIndex > 0
      ? nextHeaderOrder[removedIndex - 1]
      : nextHeaderOrder[removedIndex] ?? null;
    const nextFallbackEntry = parseRightPanelHeaderEntryKey(nextFallbackEntryKey);
    if (nextFallbackEntry?.kind === "viewer") {
      setActiveViewerTarget(nextFallbackEntry.targetKey);
    }
    updateState((previous) => {
      const removedIndex = previous.headerOrder.indexOf(targetKey);
      const headerOrder = previous.headerOrder.filter((key) => key !== targetKey);
      const fallbackEntryKey = removedIndex > 0
        ? headerOrder[removedIndex - 1]
        : headerOrder[removedIndex] ?? "tool:git";
      return {
        ...previous,
        headerOrder,
        activeEntryKey: previous.activeEntryKey === targetKey
          ? fallbackEntryKey ?? "tool:git"
          : previous.activeEntryKey,
      };
    });
  }, [
    buffersByPath,
    clearBuffer,
    closeViewerTarget,
    openViewerTargets,
    setActiveViewerTarget,
    state.headerOrder,
    updateState,
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

  const shouldMountTerminalPanel = shouldRenderContent
    && (activeTerminalId !== null || orderedTerminals.length > 0);
  const shouldMountBrowserPanel = browserTabs.length > 0;

  return (
    <RightPanelFrame
      rootRef={rootRef}
      onPointerDownCapture={handleRootPointerDownCapture}
      workspaceId={workspaceId}
      activeEntryKey={state.activeEntryKey}
      activeTool={activeTool}
      activeBrowserId={activeBrowserId}
      activeTerminalId={activeTerminalId}
      activeViewerTarget={activeViewerTarget}
      entries={headerEntries}
      unreadByTerminal={unreadByTerminal}
      buffersByPath={buffersByPath}
      tabModes={tabModes}
      browserTabs={browserTabs}
      orderedTerminals={orderedTerminals}
      isOpen={isOpen}
      isWorkspaceReady={isWorkspaceReady}
      shouldRenderContent={shouldRenderContent}
      shouldMountBrowserPanel={shouldMountBrowserPanel}
      shouldMountTerminalPanel={shouldMountTerminalPanel}
      canCreateBrowserTab={canCreateBrowserTab}
      canConnectTerminals={terminalsQuery.isSuccess}
      isLoadingTerminals={terminalsQuery.isLoading && !terminalsQuery.data}
      terminalListErrorMessage={terminalsQuery.isError ? "Terminal list unavailable" : null}
      terminalFocusRequestToken={terminalActivationRequestToken + terminalFocusNonce}
      newTabMenuRequestToken={newTabMenuRequest.token}
      newTabMenuDefaultKind={newTabMenuRequest.defaultKind}
      nativeOverlaysHidden={nativeOverlaysHidden}
      onActivateTool={activateTool}
      onSelectTerminal={selectTerminal}
      onSelectBrowser={selectBrowser}
      onSelectViewerTarget={selectViewer}
      onCloseTerminal={handleCloseTerminal}
      onCloseBrowser={handleCloseBrowser}
      onCloseViewerTarget={handleCloseViewer}
      onRenameTerminal={handleRenameTerminal}
      onCreateTerminal={() => {
        void createTerminal({ activate: true });
      }}
      onCreateBrowser={handleCreateBrowser}
      onOpenRepoSettings={() => navigate(repoSettingsHref)}
      onReorderHeaderEntry={handleReorderHeaderEntry}
      onUpdateBrowserUrl={handleUpdateBrowserUrl}
      onTogglePanel={onTogglePanel}
    />
  );
});
