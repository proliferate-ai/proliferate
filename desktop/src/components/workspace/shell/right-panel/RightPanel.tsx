import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import {
  availableRightPanelTools,
  parseRightPanelHeaderEntryKey,
  reconcileRightPanelWorkspaceState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import { isApplePlatform, isTextEntryTarget } from "@/lib/domain/shortcuts/matching";
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
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  terminalActivationRequestToken: number;
}

export function RightPanel({
  workspaceId,
  isWorkspaceReady,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  state,
  onStateChange,
  terminalActivationRequestToken,
}: RightPanelProps) {
  const { createTab, closeTab, renameTab } = useTerminalActions();
  const setActiveTerminalForWorkspace = useTerminalStore(
    (store) => store.setActiveTerminalForWorkspace,
  );
  const unreadByTerminal = useTerminalStore((store) => store.unreadByTerminal);
  const showToast = useToastStore((store) => store.show);
  const [terminalFocusNonce, setTerminalFocusNonce] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const handledActivationTokenRef = useRef(0);
  const shouldRenderContent = isWorkspaceReady || shouldKeepContentVisible;
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && shouldRenderContent),
  });
  const terminals = terminalsQuery.data ?? EMPTY_TERMINALS;
  const liveTerminalIds = useMemo(
    () => terminals.map((terminal) => terminal.id),
    [terminals],
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
    () => orderTerminals(terminals, state.terminalOrder),
    [state.terminalOrder, terminals],
  );
  const terminalById = useMemo(
    () => new Map(orderedTerminals.map((terminal) => [terminal.id, terminal])),
    [orderedTerminals],
  );
  const selectedTerminal = useMemo(
    () => orderedTerminals.find((terminal) => terminal.id === state.activeTerminalId) ?? null,
    [orderedTerminals, state.activeTerminalId],
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
      if (entry.kind === "terminal") {
        const terminal = terminalById.get(entry.terminalId);
        if (terminal) {
          entries.push({ kind: "terminal", key, terminal });
          seenKeys.add(key);
        }
      }
    }

    for (const tool of orderedTools) {
      const key = rightPanelToolHeaderKey(tool);
      if (!seenKeys.has(key)) {
        entries.push({ kind: "tool", key, tool });
        seenKeys.add(key);
      }
    }
    for (const terminal of orderedTerminals) {
      const key = rightPanelTerminalHeaderKey(terminal.id);
      if (!seenKeys.has(key)) {
        entries.push({ kind: "terminal", key, terminal });
        seenKeys.add(key);
      }
    }

    return entries;
  }, [orderedTerminals, orderedTools, state.headerOrder, terminalById]);

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
        return rightPanelStateEqual(current, next) ? current : next;
      });
    },
    [isCloudWorkspaceSelected, onStateChange],
  );

  useEffect(() => {
    updateState((previous) => reconcileRightPanelWorkspaceState(previous, {
      isCloudWorkspaceSelected,
      liveTerminalIds: terminalsQuery.isSuccess ? liveTerminalIds : undefined,
    }));
  }, [
    isCloudWorkspaceSelected,
    liveTerminalIds,
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

  const createTerminal = useCallback(async () => {
    if (!workspaceId || !shouldRenderContent) {
      return null;
    }
    try {
      const terminalId = await createTab(workspaceId, 120, 40);
      const terminalKey = rightPanelTerminalHeaderKey(terminalId);
      updateState((previous) => ({
        ...previous,
        activeTool: "terminal",
        terminalOrder: previous.terminalOrder.includes(terminalId)
          ? previous.terminalOrder
          : [...previous.terminalOrder, terminalId],
        headerOrder: previous.headerOrder.includes(terminalKey)
          ? previous.headerOrder
          : [...previous.headerOrder, terminalKey],
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
    const records = result.data;

    const next = reconcileRightPanelWorkspaceState({ ...state, activeTool: "terminal" }, {
      isCloudWorkspaceSelected,
      liveTerminalIds: records.map((terminal) => terminal.id),
    });
    updateState(next);

    if (records.length === 0) {
      await createTerminal();
      return;
    }

    if (next.activeTerminalId) {
      setTerminalFocusNonce((nonce) => nonce + 1);
    } else {
      selectTerminal(records[0]!.id);
    }
  }, [
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
      if (entry.kind === "tool") {
        activateTool(entry.tool);
        return;
      }
      selectTerminal(entry.terminal.id);
    },
    [activateTool, selectTerminal],
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
        activeTerminalId={selectedTerminal?.id ?? null}
        orderedTerminals={orderedTerminals}
        unreadByTerminal={unreadByTerminal}
        isWorkspaceReady={isWorkspaceReady}
        onActivateTool={activateTool}
        onSelectTerminal={selectTerminal}
        onCloseTerminal={handleCloseTerminal}
        onRenameTerminal={handleRenameTerminal}
        onCreateTerminal={() => {
          void createTerminal();
        }}
        onReorderHeaderEntry={handleReorderHeaderEntry}
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
                  isVisible={activeTool === "terminal"}
                  isRuntimeReady={isWorkspaceReady}
                  canConnect={terminalsQuery.isSuccess}
                  isLoading={terminalsQuery.isLoading && !terminalsQuery.data}
                  errorMessage={terminalsQuery.isError ? "Terminal list unavailable" : null}
                  focusRequestToken={terminalActivationRequestToken + terminalFocusNonce}
                  onNewTerminal={() => {
                    void createTerminal();
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function orderTerminals(
  terminals: readonly TerminalRecord[],
  terminalOrder: readonly string[],
): TerminalRecord[] {
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const ordered: TerminalRecord[] = [];
  for (const terminalId of terminalOrder) {
    const terminal = byId.get(terminalId);
    if (terminal) {
      ordered.push(terminal);
      byId.delete(terminalId);
    }
  }
  ordered.push(...byId.values());
  return ordered;
}

function rightPanelStateEqual(
  left: RightPanelWorkspaceState,
  right: RightPanelWorkspaceState,
): boolean {
  return left.activeTool === right.activeTool
    && left.activeTerminalId === right.activeTerminalId
    && arraysEqual(left.toolOrder, right.toolOrder)
    && arraysEqual(left.terminalOrder, right.terminalOrder)
    && arraysEqual(left.headerOrder, right.headerOrder);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function resolvePrimaryDigitShortcutIndex(event: KeyboardEvent): number | null {
  if (event.shiftKey || event.altKey) {
    return null;
  }

  const isApple = isApplePlatform();
  const hasPrimaryModifier = isApple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!hasPrimaryModifier) {
    return null;
  }

  const keyDigit = /^[1-9]$/.test(event.key) ? Number.parseInt(event.key, 10) : null;
  const codeMatch = /^Digit([1-9])$/.exec(event.code);
  const codeDigit = codeMatch ? Number.parseInt(codeMatch[1]!, 10) : null;
  const digit = keyDigit ?? codeDigit;
  return digit ? digit - 1 : null;
}
