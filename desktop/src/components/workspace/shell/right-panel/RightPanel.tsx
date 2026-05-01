import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useNavigate } from "react-router-dom";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  availableRightPanelTools,
  parseRightPanelHeaderEntryKey,
  reconcileRightPanelWorkspaceState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  rightPanelToolHeaderKey,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import {
  orderTerminals,
  resolvePrimaryDigitShortcutIndex,
  rightPanelStateEqual,
} from "@/lib/domain/workspaces/right-panel-view";
import { createTerminalRuntimeIdentity } from "@/lib/integrations/anyharness/terminal-handles";
import { isTextEntryTarget } from "@/lib/domain/shortcuts/matching";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  RightPanelHeaderTabs,
  type HeaderEntry,
} from "@/components/workspace/shell/right-panel/RightPanelHeaderTabs";
import { RightPanelPlaceholder } from "@/components/workspace/shell/right-panel/RightPanelPlaceholder";

const EMPTY_TERMINALS: never[] = [];

interface RightPanelProps {
  workspaceId: string | null;
  isWorkspaceReady: boolean;
  shouldKeepContentVisible?: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  repoSettingsHref: string;
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  terminalActivationRequestToken: number;
}

export function RightPanel({
  workspaceId,
  isWorkspaceReady,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  state,
  repoSettingsHref,
  onStateChange,
  terminalActivationRequestToken,
}: RightPanelProps) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const { selectedCloudRuntime } = useWorkspaceRuntimeBlock();
  const navigate = useNavigate();
  const setActiveTerminalForWorkspace = useTerminalStore(
    (store) => store.setActiveTerminalForWorkspace,
  );
  const unreadByTerminal = useTerminalStore((store) => store.unreadByTerminal);
  const showToast = useToastStore((store) => store.show);
  const runtimeUrl = useHarnessStore((store) => store.runtimeUrl);
  const [terminalFocusNonce, setTerminalFocusNonce] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const handledActivationTokenRef = useRef(0);
  const defaultTerminalCreateGuardsRef = useRef(new Set<string>());
  const shouldRenderContent = isWorkspaceReady || shouldKeepContentVisible;
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && shouldRenderContent),
  });
  const terminals = terminalsQuery.data ?? EMPTY_TERMINALS;
  const visibleTerminals = useMemo(
    () => terminals.filter((terminal) =>
      terminal.purpose !== "setup" || state.terminalOrder.includes(terminal.id)
    ),
    [state.terminalOrder, terminals],
  );
  const liveTerminalIds = useMemo(
    () => visibleTerminals.map((terminal) => terminal.id),
    [visibleTerminals],
  );
  const availableTools = useMemo(
    () => availableRightPanelTools(isCloudWorkspaceSelected),
    [isCloudWorkspaceSelected],
  );
  const orderedTools = useMemo(
    () => state.toolOrder.filter((tool) => availableTools.includes(tool)),
    [availableTools, state.toolOrder],
  );
  const orderedTerminals = useMemo(
    () => orderTerminals(visibleTerminals, state.terminalOrder),
    [state.terminalOrder, visibleTerminals],
  );
  const selectedTerminal = useMemo(
    () => orderedTerminals.find((terminal) => terminal.id === state.activeTerminalId) ?? null,
    [orderedTerminals, state.activeTerminalId],
  );
  const hasUnreadTerminal = useMemo(
    () => orderedTerminals.some((terminal) => unreadByTerminal[terminal.id] === true),
    [orderedTerminals, unreadByTerminal],
  );
  const hasGeneralTerminal = useMemo(
    () => terminals.some((terminal) => terminal.purpose === "general"),
    [terminals],
  );
  const activeTool = state.activeTool === "terminal"
    ? "terminal"
    : orderedTools.includes(state.activeTool)
      ? state.activeTool
      : "git";
  const headerEntries = useMemo<HeaderEntry[]>(() => {
    const entries: HeaderEntry[] = [];
    const seenKeys = new Set<RightPanelHeaderEntryKey>();
    const availableToolSet = new Set(orderedTools);

    for (const key of state.headerOrder) {
      const entry = parseRightPanelHeaderEntryKey(key);
      if (!entry || seenKeys.has(key)) {
        continue;
      }
      if (entry.kind === "tool" && availableToolSet.has(entry.tool)) {
        entries.push({ kind: "tool", key, tool: entry.tool });
        seenKeys.add(key);
      }
    }

    for (const tool of orderedTools) {
      const key = rightPanelToolHeaderKey(tool);
      if (!seenKeys.has(key)) {
        entries.push({ kind: "tool", key, tool });
        seenKeys.add(key);
      }
    }

    return entries;
  }, [orderedTools, state.headerOrder]);

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
        if (!rightPanelStateEqual(current, next)) {
          return next;
        }
        return rightPanelStateEqual(previous, current) ? previous : current;
      });
    },
    [isCloudWorkspaceSelected, onStateChange],
  );

  useEffect(() => {
    const next = reconcileRightPanelWorkspaceState(state, {
      isCloudWorkspaceSelected,
      liveTerminalIds: terminalsQuery.isSuccess ? liveTerminalIds : undefined,
    });
    if (rightPanelStateEqual(state, next)) {
      return;
    }
    updateState(next);
  }, [
    isCloudWorkspaceSelected,
    liveTerminalIds,
    state,
    terminalsQuery.isSuccess,
    updateState,
  ]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    setActiveTerminalForWorkspace(
      workspaceId,
      state.activeTool === "terminal" ? state.activeTerminalId : null,
    );
  }, [
    setActiveTerminalForWorkspace,
    state.activeTerminalId,
    state.activeTool,
    workspaceId,
  ]);

  const selectTerminal = useCallback((terminalId: string) => {
    updateState((previous) => ({
      ...previous,
      activeTool: "terminal",
      activeTerminalId: terminalId,
    }));
    if (workspaceId) {
      setActiveTerminalForWorkspace(workspaceId, terminalId);
    }
    setTerminalFocusNonce((nonce) => nonce + 1);
  }, [setActiveTerminalForWorkspace, updateState, workspaceId]);

  const createTerminal = useCallback(async (options?: { purpose?: "general" }) => {
    if (!workspaceId || !shouldRenderContent) {
      return null;
    }
    try {
      const terminalId = await createTab(workspaceId, 120, 40, {
        purpose: options?.purpose ?? "general",
      });
      updateState((previous) => ({
        ...previous,
        activeTool: "terminal",
        terminalOrder: previous.terminalOrder.includes(terminalId)
          ? previous.terminalOrder
          : [...previous.terminalOrder, terminalId],
        activeTerminalId: terminalId,
      }));
      setTerminalFocusNonce((nonce) => nonce + 1);
      return terminalId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to create terminal tab: ${message}`);
      return null;
    }
  }, [createTab, shouldRenderContent, showToast, updateState, workspaceId]);

  const defaultTerminalRuntimeIdentity = useMemo(() => {
    if (!workspaceId) {
      return null;
    }
    if (parseCloudWorkspaceSyntheticId(workspaceId)) {
      if (
        selectedCloudRuntime.workspaceId !== workspaceId
        || selectedCloudRuntime.state?.phase !== "ready"
        || !selectedCloudRuntime.connectionInfo
      ) {
        return null;
      }
      return createTerminalRuntimeIdentity({
        runtimeUrl: selectedCloudRuntime.connectionInfo.runtimeUrl,
        anyharnessWorkspaceId: selectedCloudRuntime.connectionInfo.anyharnessWorkspaceId ?? "",
        runtimeGeneration: selectedCloudRuntime.connectionInfo.runtimeGeneration,
      });
    }
    return createTerminalRuntimeIdentity({
      runtimeUrl,
      anyharnessWorkspaceId: workspaceId,
    });
  }, [
    runtimeUrl,
    selectedCloudRuntime.connectionInfo,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
    workspaceId,
  ]);
  const defaultTerminalGuardKey = workspaceId && defaultTerminalRuntimeIdentity
    ? `${workspaceId}:${defaultTerminalRuntimeIdentity}`
    : null;

  const createDefaultTerminalOnce = useCallback(async () => {
    if (!defaultTerminalGuardKey) {
      return null;
    }
    if (defaultTerminalCreateGuardsRef.current.has(defaultTerminalGuardKey)) {
      return null;
    }
    defaultTerminalCreateGuardsRef.current.add(defaultTerminalGuardKey);
    const terminalId = await createTerminal({ purpose: "general" });
    if (!terminalId) {
      defaultTerminalCreateGuardsRef.current.delete(defaultTerminalGuardKey);
    }
    return terminalId;
  }, [createTerminal, defaultTerminalGuardKey]);

  useEffect(() => {
    if (!workspaceId || !defaultTerminalGuardKey) {
      return;
    }
    for (const key of defaultTerminalCreateGuardsRef.current) {
      if (key.startsWith(`${workspaceId}:`) && key !== defaultTerminalGuardKey) {
        defaultTerminalCreateGuardsRef.current.delete(key);
      }
    }
  }, [defaultTerminalGuardKey, workspaceId]);

  useEffect(() => {
    if (
      !workspaceId
      || !defaultTerminalGuardKey
      || activeTool !== "terminal"
      || !shouldRenderContent
      || !isWorkspaceReady
      || !terminalsQuery.isSuccess
      || hasGeneralTerminal
      || defaultTerminalCreateGuardsRef.current.has(defaultTerminalGuardKey)
    ) {
      return;
    }

    void createDefaultTerminalOnce();
  }, [
    activeTool,
    createDefaultTerminalOnce,
    defaultTerminalGuardKey,
    hasGeneralTerminal,
    isWorkspaceReady,
    shouldRenderContent,
    terminalsQuery.isSuccess,
    workspaceId,
  ]);

  const activateTerminalTool = useCallback(async () => {
    updateState((previous) => ({ ...previous, activeTool: "terminal" }));
    setTerminalFocusNonce((nonce) => nonce + 1);

    if (!workspaceId || !shouldRenderContent) {
      return;
    }

    if (terminalsQuery.isLoading || (terminalsQuery.isFetching && !terminalsQuery.data)) {
      showToast("Terminals are loading.");
      return;
    }

    const result = await terminalsQuery.refetch();
    if (!result.data) {
      showToast("Failed to load terminals.");
      return;
    }
    const records = result.data.filter((terminal) =>
      terminal.purpose !== "setup" || state.terminalOrder.includes(terminal.id)
    );

    const next = reconcileRightPanelWorkspaceState({ ...state, activeTool: "terminal" }, {
      isCloudWorkspaceSelected,
      liveTerminalIds: records.map((terminal) => terminal.id),
    });
    updateState(next);

    if (!records.some((terminal) => terminal.purpose === "general")) {
      await createDefaultTerminalOnce();
      return;
    }

    if (next.activeTerminalId) {
      setTerminalFocusNonce((nonce) => nonce + 1);
    } else {
      selectTerminal(records[0]!.id);
    }
  }, [
    createDefaultTerminalOnce,
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
    if (
      terminalActivationRequestToken === 0
      || handledActivationTokenRef.current === terminalActivationRequestToken
    ) {
      return;
    }
    handledActivationTokenRef.current = terminalActivationRequestToken;
    void activateTerminalTool();
  }, [activateTerminalTool, terminalActivationRequestToken]);

  const activateTool = useCallback(
    (tool: RightPanelTool) => {
      if (tool === "terminal") {
        void activateTerminalTool();
        return;
      }
      updateState((previous) => ({ ...previous, activeTool: tool }));
    },
    [activateTerminalTool, updateState],
  );

  const activateHeaderEntry = useCallback(
    (entry: HeaderEntry) => {
      activateTool(entry.tool);
    },
    [activateTool],
  );

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

      const eventTargetElement = event.target instanceof Element ? event.target : null;
      const isTerminalTarget = Boolean(
        eventTargetElement?.closest('[data-focus-zone="terminal"]'),
      );
      if (isTextEntryTarget(event.target) && !isTerminalTarget) {
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
    && (activeTool === "terminal" || orderedTerminals.length > 0);

  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-group="true"
      className="relative flex h-full flex-col overflow-hidden rounded-tl-lg border-l border-t border-sidebar-border bg-sidebar-background"
    >
      <RightPanelHeaderTabs
        entries={headerEntries}
        activeTool={activeTool}
        hasTerminalUnread={hasUnreadTerminal}
        isWorkspaceReady={isWorkspaceReady}
        onActivateTool={activateTool}
        onCreateTerminal={() => {
          void createTerminal();
        }}
        onReorderHeaderEntry={handleReorderHeaderEntry}
        onOpenRepoSettings={() => navigate(repoSettingsHref)}
      />

      <div
        data-panel="true"
        id="workspace-side-panel"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {!shouldRenderContent ? (
          <RightPanelPlaceholder tool={activeTool} />
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
            {shouldMountTerminalPanel && (
              <div className={activeTool === "terminal" ? "absolute inset-0" : "hidden"}>
                <TerminalPanel
                  workspaceId={workspaceId}
                  terminals={orderedTerminals}
                  activeTerminalId={selectedTerminal?.id ?? null}
                  unreadByTerminal={unreadByTerminal}
                  isVisible={activeTool === "terminal"}
                  isRuntimeReady={isWorkspaceReady}
                  canConnect={terminalsQuery.isSuccess}
                  isLoading={terminalsQuery.isLoading && !terminalsQuery.data}
                  errorMessage={terminalsQuery.isError ? "Terminal list unavailable" : null}
                  focusRequestToken={terminalActivationRequestToken + terminalFocusNonce}
                  onNewTerminal={() => {
                    void createTerminal();
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
