import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useNavigate } from "react-router-dom";
import { WorkspaceBrowserPanel } from "@/components/workspace/browser/WorkspaceBrowserPanel";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import {
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  availableRightPanelTools,
  canCreateRightPanelBrowserTab,
  createBrowserTabInRightPanelState,
  createRightPanelBrowserTabId,
  parseRightPanelHeaderEntryKey,
  reconcileRightPanelWorkspaceState,
  removeBrowserTabFromRightPanelState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  terminalIdsFromHeaderOrder,
  updateBrowserTabUrlInRightPanelState,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import {
  orderBrowserTabs,
  orderTerminals,
  resolvePrimaryDigitShortcutIndex,
  rightPanelStateEqual,
} from "@/lib/domain/workspaces/right-panel-view";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  RIGHT_PANEL_NEW_TAB_MENU_EVENT,
  rightPanelNewTabMenuDefaultFromEvent,
  type RightPanelNewTabMenuDefault,
} from "@/lib/infra/right-panel-new-tab-menu";
import {
  RightPanelHeaderTabs,
  type HeaderEntry,
} from "@/components/workspace/shell/right-panel/RightPanelHeaderTabs";
import { RightPanelPlaceholder } from "@/components/workspace/shell/right-panel/RightPanelPlaceholder";

const EMPTY_TERMINALS: never[] = [];

function shouldPreservePointerFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  return Boolean(target.closest(
    [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "iframe",
      "[contenteditable='true']",
      "[role='button']",
      "[tabindex]:not([tabindex='-1'])",
      "[data-focus-zone='terminal']",
      "[data-focus-zone='browser']",
    ].join(","),
  ));
}

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
  nativeOverlaysHidden?: boolean;
  onTerminalActivationRequestHandled: (request: TerminalActivationRequest) => void;
}

export function RightPanel({
  workspaceId,
  isWorkspaceReady,
  isOpen,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  state,
  repoSettingsHref,
  onStateChange,
  terminalActivationRequest,
  nativeOverlaysHidden = false,
  onTerminalActivationRequestHandled,
}: RightPanelProps) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const navigate = useNavigate();
  const setActiveTerminalForWorkspace = useTerminalStore(
    (store) => store.setActiveTerminalForWorkspace,
  );
  const unreadByTerminal = useTerminalStore((store) => store.unreadByTerminal);
  const showToast = useToastStore((store) => store.show);
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
  const terminalIdsInHeader = useMemo(
    () => new Set(terminalIdsFromHeaderOrder(state.headerOrder)),
    [state.headerOrder],
  );
  const visibleTerminals = useMemo(
    () => terminals.filter((terminal) =>
      terminal.purpose !== "setup" || terminalIdsInHeader.has(terminal.id)
    ),
    [terminalIdsInHeader, terminals],
  );
  const terminalById = useMemo(
    () => new Map(visibleTerminals.map((terminal) => [terminal.id, terminal])),
    [visibleTerminals],
  );
  const orderedTerminals = useMemo(
    () => orderTerminals(visibleTerminals, state.headerOrder),
    [state.headerOrder, visibleTerminals],
  );
  const activeEntry = useMemo(
    () => parseRightPanelHeaderEntryKey(state.activeEntryKey),
    [state.activeEntryKey],
  );
  const activeTool = activeEntry?.kind === "tool" ? activeEntry.tool : null;
  const activeTerminalId = activeEntry?.kind === "terminal" ? activeEntry.terminalId : null;
  const activeBrowserId = activeEntry?.kind === "browser" ? activeEntry.browserId : null;
  const terminalActivationRequestToken = terminalActivationRequest?.workspaceId === workspaceId
    ? terminalActivationRequest.token
    : 0;
  const browserTabs = useMemo(
    () => orderBrowserTabs(state.browserTabsById, state.headerOrder),
    [state.browserTabsById, state.headerOrder],
  );
  const canCreateBrowserTab = canCreateRightPanelBrowserTab(state);

  const headerEntries = useMemo<HeaderEntry[]>(() => {
    const entries: HeaderEntry[] = [];
    const seenKeys = new Set<RightPanelHeaderEntryKey>();
    const availableToolSet = new Set(availableRightPanelTools(isCloudWorkspaceSelected));

    for (const key of state.headerOrder) {
      const entry = parseRightPanelHeaderEntryKey(key);
      if (!entry || seenKeys.has(key)) {
        continue;
      }
      if (entry.kind === "tool" && availableToolSet.has(entry.tool)) {
        entries.push({ kind: "tool", key, tool: entry.tool });
        seenKeys.add(key);
      }
      if (entry.kind === "terminal") {
        entries.push({
          kind: "terminal",
          key,
          terminalId: entry.terminalId,
          terminal: terminalById.get(entry.terminalId) ?? null,
        });
        seenKeys.add(key);
      }
      if (entry.kind === "browser") {
        const tab = state.browserTabsById[entry.browserId];
        if (tab) {
          entries.push({ kind: "browser", key, tab });
          seenKeys.add(key);
        }
      }
    }

    return entries;
  }, [isCloudWorkspaceSelected, state.browserTabsById, state.headerOrder, terminalById]);

  const updateState = useCallback(
    (value: SetStateAction<RightPanelWorkspaceState>) => {
      onStateChange((previous) => {
        const current = reconcileRightPanelWorkspaceState(previous, {
          isCloudWorkspaceSelected,
        });
        const next = typeof value === "function"
          ? (value as (previousValue: RightPanelWorkspaceState) => RightPanelWorkspaceState)(
              current,
            )
          : value;
        const reconciledNext = reconcileRightPanelWorkspaceState(next, {
          isCloudWorkspaceSelected,
        });
        if (!rightPanelStateEqual(current, reconciledNext)) {
          return reconciledNext;
        }
        return rightPanelStateEqual(previous, current) ? previous : current;
      });
    },
    [isCloudWorkspaceSelected, onStateChange],
  );

  useEffect(() => {
    const next = reconcileRightPanelWorkspaceState(state, {
      isCloudWorkspaceSelected,
      liveTerminals: terminalsQuery.isSuccess ? terminals : undefined,
    });
    if (rightPanelStateEqual(state, next)) {
      return;
    }
    updateState(next);
  }, [
    isCloudWorkspaceSelected,
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

  const activateHeaderEntry = useCallback(
    (entry: HeaderEntry) => {
      if (entry.kind === "tool") {
        activateTool(entry.tool);
        return;
      }
      if (entry.kind === "terminal") {
        selectTerminal(entry.terminalId);
        return;
      }
      selectBrowser(entry.tab.id);
    },
    [activateTool, selectBrowser, selectTerminal],
  );

  const handleRootPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldPreservePointerFocus(event.target)) {
      return;
    }

    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutIndex = resolvePrimaryDigitShortcutIndex(event);
      if (shortcutIndex === null) {
        return;
      }

      const root = rootRef.current;
      const activeElement = document.activeElement;
      if (!root || !(activeElement instanceof Element) || !root.contains(activeElement)) {
        return;
      }

      const entry = headerEntries[shortcutIndex];
      if (!entry) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activateHeaderEntry(entry);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activateHeaderEntry, headerEntries]);

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
      updateState((previous) =>
        reorderHeaderEntryInRightPanelState(
          previous,
          entryKey,
          beforeEntryKey,
          isCloudWorkspaceSelected,
        ),
      );
    },
    [isCloudWorkspaceSelected, updateState],
  );

  const shouldMountTerminalPanel = shouldRenderContent
    && (activeTerminalId !== null || orderedTerminals.length > 0);
  const shouldMountBrowserPanel = browserTabs.length > 0;

  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-group="true"
      tabIndex={-1}
      onPointerDownCapture={handleRootPointerDownCapture}
      className="relative flex h-full flex-col overflow-hidden rounded-tl-lg border-l border-t border-sidebar-border bg-sidebar-background outline-none"
    >
      <RightPanelHeaderTabs
        entries={headerEntries}
        activeEntryKey={state.activeEntryKey}
        unreadByTerminal={unreadByTerminal}
        isWorkspaceReady={isWorkspaceReady}
        canCreateBrowserTab={canCreateBrowserTab}
        newTabMenuRequestToken={newTabMenuRequest.token}
        newTabMenuDefaultKind={newTabMenuRequest.defaultKind}
        onActivateTool={activateTool}
        onSelectTerminal={selectTerminal}
        onSelectBrowser={selectBrowser}
        onCloseTerminal={handleCloseTerminal}
        onCloseBrowser={handleCloseBrowser}
        onRenameTerminal={handleRenameTerminal}
        onCreateTerminal={() => {
          void createTerminal({ activate: true });
        }}
        onCreateBrowser={handleCreateBrowser}
        onReorderHeaderEntry={handleReorderHeaderEntry}
        onOpenRepoSettings={() => navigate(repoSettingsHref)}
      />

      <div
        data-panel="true"
        id="workspace-side-panel"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {!shouldRenderContent ? (
          <RightPanelPlaceholder activeEntryKey={state.activeEntryKey} />
        ) : (
          <>
            {activeTool === "files" && (
              <div className="absolute inset-0">
                <WorkspaceFilesPanel showHeader={false} />
              </div>
            )}
            {activeTool === "settings" && (
              <div className="absolute inset-0">
                <CloudWorkspaceSettingsPanel />
              </div>
            )}
            {activeTool === "git" && (
              <div className="absolute inset-0">
                <GitPanel />
              </div>
            )}
            {shouldMountBrowserPanel && (
              <div className={activeBrowserId ? "absolute inset-0" : "hidden"}>
                <WorkspaceBrowserPanel
                  workspaceId={workspaceId}
                  tabs={browserTabs}
                  activeBrowserId={activeBrowserId}
                  isVisible={isOpen && activeBrowserId !== null}
                  nativeOverlaysHidden={nativeOverlaysHidden}
                  onUpdateUrl={handleUpdateBrowserUrl}
                />
              </div>
            )}
            {shouldMountTerminalPanel && (
              <div className={activeTerminalId ? "absolute inset-0" : "hidden"}>
                <TerminalPanel
                  workspaceId={workspaceId}
                  terminals={orderedTerminals}
                  activeTerminalId={activeTerminalId}
                  isVisible={activeTerminalId !== null}
                  isRuntimeReady={isWorkspaceReady}
                  canConnect={terminalsQuery.isSuccess}
                  isLoading={terminalsQuery.isLoading && !terminalsQuery.data}
                  errorMessage={terminalsQuery.isError ? "Terminal list unavailable" : null}
                  focusRequestToken={terminalActivationRequestToken + terminalFocusNonce}
                  unreadByTerminal={unreadByTerminal}
                  onNewTerminal={() => {
                    void createTerminal({ activate: true });
                  }}
                  onSelectTerminal={selectTerminal}
                  onCloseTerminal={handleCloseTerminal}
                  onRenameTerminal={handleRenameTerminal}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
