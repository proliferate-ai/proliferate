import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import {
  Check,
  FileIcon,
  GitBranchIcon,
  Pencil,
  Plus,
  Settings,
  Terminal as TerminalIcon,
  X,
  type IconProps,
} from "@/components/ui/icons";
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

interface PanelToolConfig {
  id: RightPanelTool;
  label: string;
  icon: ComponentType<IconProps>;
}

const PANEL_TOOLS: Record<RightPanelTool, PanelToolConfig> = {
  files: { id: "files", label: "Files", icon: FileIcon },
  git: { id: "git", label: "Git", icon: GitBranchIcon },
  settings: { id: "settings", label: "Cloud settings", icon: Settings },
  terminal: { id: "terminal", label: "Terminal", icon: TerminalIcon },
};

const EMPTY_TERMINALS: never[] = [];
const HEADER_STABLE_TAB_CLASS = "ui-tab-system-tab";
const HEADER_TERMINAL_TAB_CLASS = "ui-tab-system-tab right-panel-terminal-tab";
const HEADER_TAB_EDIT_CLASS =
  "ui-tab-system-tab right-panel-terminal-tab right-panel-terminal-tab--editing";
const HEADER_TAB_ACTION_CLASS = "ui-icon-button right-panel-terminal-edit-action";

type HeaderEntry =
  | { kind: "tool"; key: RightPanelHeaderEntryKey; tool: RightPanelTool }
  | { kind: "terminal"; key: RightPanelHeaderEntryKey; terminal: TerminalRecord };

interface HeaderDragSession {
  key: RightPanelHeaderEntryKey;
  pointerId: number;
  startX: number;
  startY: number;
  isDragging: boolean;
}

const HEADER_DRAG_THRESHOLD_PX = 4;

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
  const [draggedHeaderKey, setDraggedHeaderKey] = useState<RightPanelHeaderEntryKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerEntryNodesRef = useRef(new Map<RightPanelHeaderEntryKey, HTMLDivElement>());
  const headerDragSessionRef = useRef<HeaderDragSession | null>(null);
  const suppressNextHeaderClickRef = useRef(false);
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

  const registerHeaderEntryNode = useCallback((
    entryKey: RightPanelHeaderEntryKey,
    node: HTMLDivElement | null,
  ) => {
    if (node) {
      headerEntryNodesRef.current.set(entryKey, node);
      return;
    }
    headerEntryNodesRef.current.delete(entryKey);
  }, []);

  const resolveHeaderDropBeforeKey = useCallback((
    clientX: number,
    draggedKey: RightPanelHeaderEntryKey,
  ): RightPanelHeaderEntryKey | null => {
    const candidates = [...headerEntryNodesRef.current.entries()]
      .filter(([entryKey]) => entryKey !== draggedKey)
      .map(([entryKey, node]) => ({
        entryKey,
        rect: node.getBoundingClientRect(),
      }))
      .sort((left, right) => left.rect.left - right.rect.left);

    const target = candidates.find(({ rect }) => clientX < rect.left + rect.width / 2);
    return target?.entryKey ?? null;
  }, []);

  const suppressNextHeaderClick = useCallback(() => {
    suppressNextHeaderClickRef.current = true;
    window.setTimeout(() => {
      suppressNextHeaderClickRef.current = false;
    }, 50);
  }, []);

  const shouldSuppressHeaderClick = useCallback(() => {
    if (!suppressNextHeaderClickRef.current) {
      return false;
    }
    suppressNextHeaderClickRef.current = false;
    return true;
  }, []);

  const handleHeaderPointerDown = useCallback((
    entryKey: RightPanelHeaderEntryKey,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-right-panel-tab-no-drag='true']")) {
      return;
    }

    headerDragSessionRef.current = {
      key: entryKey,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleHeaderPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (!session.isDragging) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < HEADER_DRAG_THRESHOLD_PX) {
        return;
      }
      session.isDragging = true;
      setDraggedHeaderKey(session.key);
    }

    event.preventDefault();
    handleReorderHeaderEntry(
      session.key,
      resolveHeaderDropBeforeKey(event.clientX, session.key),
    );
  }, [handleReorderHeaderEntry, resolveHeaderDropBeforeKey]);

  const finishHeaderPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (session.isDragging) {
      event.preventDefault();
      suppressNextHeaderClick();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    headerDragSessionRef.current = null;
    setDraggedHeaderKey(null);
  }, [suppressNextHeaderClick]);

  const shouldMountTerminalPanel = shouldRenderContent
    && (activeTool === "terminal" || orderedTerminals.length > 0);

  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-group="true"
      className="relative flex h-full flex-col overflow-hidden rounded-tl-lg border-l border-t border-sidebar-border bg-sidebar-background"
    >
      <div className="right-panel-tab-system ui-tab-system editor-panel-tab-root editor-panel-tab-root--simple-tabs border-b border-sidebar-border/70">
        <div className="ui-tab-system-bar">
          <div className="editor-panel-tab-bar-tab-cluster">
            <output
              className="ui-tab-system-live-region"
              aria-live="polite"
              aria-atomic="true"
            />

            <div
              className="ui-tab-system-tabs__scrollable ui-tab-system-tabs__scrollable--sections"
              data-has-stable="true"
            >
              <div
                className="ui-tab-system-tabs__viewport"
                role="tablist"
                aria-label="Right panel tabs"
                aria-orientation="horizontal"
              >
                <div className="ui-tab-system-tabs__section" data-tab-section="workspace">
                  {headerEntries.map((entry) => {
                    if (entry.kind === "tool") {
                      const panelTool = PANEL_TOOLS[entry.tool];
                      const Icon = panelTool.icon;
                      const isActive = activeTool === entry.tool;
                      return (
                        <RightPanelHeaderEntryDropZone
                          key={entry.key}
                          entryKey={entry.key}
                          isDragging={draggedHeaderKey === entry.key}
                          onRegister={registerHeaderEntryNode}
                          onPointerDown={handleHeaderPointerDown}
                          onPointerMove={handleHeaderPointerMove}
                          onPointerUp={finishHeaderPointerDrag}
                          onPointerCancel={finishHeaderPointerDrag}
                        >
                          <Tooltip
                            content={panelTool.label}
                            className="right-panel-tab-tooltip"
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              role="tab"
                              aria-selected={isActive}
                              aria-controls={`tabpanel-workspace-right-panel-${entry.tool}`}
                              tabIndex={isActive ? 0 : -1}
                              data-reorderable="true"
                              data-stable="true"
                              data-active={isActive ? true : undefined}
                              data-app-active={isActive ? true : undefined}
                              aria-grabbed={draggedHeaderKey === entry.key}
                              aria-label={panelTool.label}
                              onClick={() => {
                                if (shouldSuppressHeaderClick()) {
                                  return;
                                }
                                activateTool(entry.tool);
                              }}
                              className={HEADER_STABLE_TAB_CLASS}
                            >
                              <span className="ui-tab-system-tab__content">
                                <Icon className="ui-tab-system-tab__icon" />
                                <span
                                  className="ui-tab-system-tab__dirty-indicator"
                                  aria-hidden="true"
                                />
                              </span>
                            </Button>
                          </Tooltip>
                        </RightPanelHeaderEntryDropZone>
                      );
                    }

                    const terminal = entry.terminal;
                    const terminalIndex = orderedTerminals.findIndex(
                      (item) => item.id === terminal.id,
                    );
                    const isActive = activeTool === "terminal"
                      && terminal.id === selectedTerminal?.id;
                    const fallbackTitle = `Terminal ${Math.max(terminalIndex, 0) + 1}`;
                    const displayTitle = terminal.title === "Terminal"
                      ? fallbackTitle
                      : terminal.title;
                    return (
                      <RightPanelHeaderEntryDropZone
                        key={entry.key}
                        entryKey={entry.key}
                        isDragging={draggedHeaderKey === entry.key}
                        onRegister={registerHeaderEntryNode}
                        onPointerDown={handleHeaderPointerDown}
                        onPointerMove={handleHeaderPointerMove}
                        onPointerUp={finishHeaderPointerDrag}
                        onPointerCancel={finishHeaderPointerDrag}
                      >
                        <TerminalHeaderIcon
                          terminal={terminal}
                          displayTitle={displayTitle}
                          isActive={isActive}
                          unread={unreadByTerminal[terminal.id] === true}
                          isRuntimeReady={isWorkspaceReady}
                          isDragging={draggedHeaderKey === entry.key}
                          shouldSuppressClick={shouldSuppressHeaderClick}
                          onSelect={() => selectTerminal(terminal.id)}
                          onClose={() => handleCloseTerminal(terminal.id)}
                          onRename={(title) => handleRenameTerminal(terminal.id, title)}
                        />
                      </RightPanelHeaderEntryDropZone>
                    );
                  })}

                  <div className="right-panel-tab-drop-target" />
                </div>
              </div>
              <div className="ui-tab-system-tabs__spacer" aria-hidden="true" />
            </div>
          </div>

          <div className="ui-tab-system-section ui-tab-system-section__trailing">
            <div className="editor-panel-overflow-action">
              <Tooltip
                content="Open new tab menu"
                className="right-panel-new-tab-tooltip"
              >
                <PopoverButton
                  align="end"
                  trigger={
                    <IconButton
                      size="xs"
                      tone="sidebar"
                      title="Open new tab menu"
                      className="ui-icon-button glass-editor-panel-new-tab-menu-trigger"
                    >
                      <Plus className="ui-icon" />
                    </IconButton>
                  }
                  className="w-40 rounded-md border border-border bg-popover p-1 shadow-floating"
                >
                  {(close) => (
                    <PopoverMenuItem
                      label="Terminal"
                      variant="sidebar"
                      icon={<TerminalIcon className="size-4" />}
                      disabled={!isWorkspaceReady}
                      onClick={() => {
                        close();
                        void createTerminal();
                      }}
                    />
                  )}
                </PopoverButton>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

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

function RightPanelPlaceholder({ tool }: { tool: RightPanelTool }) {
  const title = tool === "files"
    ? "Files are getting ready"
    : tool === "terminal"
      ? "Terminals are getting ready"
      : tool === "settings"
        ? "Cloud settings are getting ready"
        : "Git view is getting ready";
  const description = tool === "files"
    ? "The file tree will appear here as soon as the workspace finishes loading."
    : tool === "terminal"
      ? "Terminals will connect once the workspace runtime is ready."
      : tool === "settings"
        ? "Repo sync status and setup controls will appear once the cloud workspace finishes loading."
        : "Changes and diffs will appear here as soon as the workspace finishes loading.";

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-xs space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

interface TerminalHeaderIconProps {
  terminal: TerminalRecord;
  displayTitle: string;
  isActive: boolean;
  unread: boolean;
  isRuntimeReady: boolean;
  isDragging: boolean;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
}

interface RightPanelHeaderEntryDropZoneProps {
  entryKey: RightPanelHeaderEntryKey;
  isDragging: boolean;
  onRegister: (entryKey: RightPanelHeaderEntryKey, node: HTMLDivElement | null) => void;
  onPointerDown: (
    entryKey: RightPanelHeaderEntryKey,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

function RightPanelHeaderEntryDropZone({
  entryKey,
  isDragging,
  onRegister,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  children,
}: RightPanelHeaderEntryDropZoneProps) {
  const setNode = useCallback(
    (node: HTMLDivElement | null) => onRegister(entryKey, node),
    [entryKey, onRegister],
  );

  return (
    <div
      ref={setNode}
      className="right-panel-header-entry-shell"
      data-dragging={isDragging ? true : undefined}
      onPointerDown={(event) => onPointerDown(entryKey, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      {children}
    </div>
  );
}

function TerminalHeaderIcon({
  terminal,
  displayTitle,
  isActive,
  unread,
  isRuntimeReady,
  isDragging,
  shouldSuppressClick,
  onSelect,
  onClose,
  onRename,
}: TerminalHeaderIconProps) {
  const [renameDraft, setRenameDraft] = useState(displayTitle);
  const [renaming, setRenaming] = useState(false);
  const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState(false);

  useEffect(() => {
    if (!isEditingHeaderTitle) {
      setRenameDraft(displayTitle);
    }
  }, [displayTitle, isEditingHeaderTitle]);

  const submitRename = (title: string, onDone?: () => void) => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle.length > 160) {
      return;
    }
    setRenaming(true);
    onRename(nextTitle)
      .then(() => {
        setIsEditingHeaderTitle(false);
        onDone?.();
      })
      .catch(() => undefined)
      .finally(() => setRenaming(false));
  };

  if (isActive && isEditingHeaderTitle) {
    return (
      <div className="right-panel-terminal-tab-shell" data-right-panel-tab-no-drag="true">
        <form
          className={HEADER_TAB_EDIT_CLASS}
          onSubmit={(event) => {
            event.preventDefault();
            submitRename(renameDraft);
          }}
          data-active="true"
          data-label-editing="true"
        >
          <div className="ui-tab-system-tab__content">
            <TerminalIcon className="ui-tab-system-tab__icon" />
            <span className="ui-tab-system-tab__label-edit-slot">
              <Input
                value={renameDraft}
                maxLength={160}
                onChange={(event) => setRenameDraft(event.target.value)}
                className="ui-tab-system-tab__label-input"
                autoFocus
              />
            </span>
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              title="Save terminal title"
              aria-label="Save terminal title"
              disabled={renaming || !renameDraft.trim()}
              className={HEADER_TAB_ACTION_CLASS}
            >
              <Check className="ui-icon" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Cancel terminal title edit"
              aria-label="Cancel terminal title edit"
              className={HEADER_TAB_ACTION_CLASS}
              onClick={() => {
                setRenameDraft(displayTitle);
                setIsEditingHeaderTitle(false);
              }}
            >
              <X className="ui-icon" />
            </Button>
          </div>
        </form>
      </div>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={displayTitle}
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-editor-panel-group-terminal-${terminal.id}`}
      tabIndex={isActive ? 0 : -1}
      data-reorderable="true"
      aria-grabbed={isDragging}
      data-active={isActive ? true : undefined}
      data-dragging={isDragging ? true : undefined}
      onClick={() => {
        if (shouldSuppressClick()) {
          return;
        }
        onSelect();
      }}
      onDoubleClick={() => setIsEditingHeaderTitle(true)}
      className={HEADER_TERMINAL_TAB_CLASS}
    >
      <span className="ui-tab-system-tab__content">
        <TerminalIcon className="ui-tab-system-tab__icon" />
        <span className="ui-tab-system-tab__label">
          <span className="ui-tab-system-tab__label-primary">{displayTitle}</span>
        </span>
        <span
          className="ui-tab-system-tab__dirty-indicator"
          data-dirty={unread ? true : undefined}
          aria-hidden="true"
        />
      </span>
    </Button>
  );

  return (
    <Tooltip content={displayTitle} className="right-panel-terminal-tooltip">
      <div className="right-panel-terminal-tab-shell">
        <PopoverButton
          triggerMode="contextMenu"
          side="bottom"
          align="start"
          className="w-56 rounded-md border border-border bg-popover p-1 shadow-floating"
          trigger={trigger}
        >
          {(close) => (
            <form
              className="flex flex-col gap-2 p-1"
              onSubmit={(event) => {
                event.preventDefault();
                const title = renameDraft.trim();
                if (!title || title.length > 160) {
                  return;
                }
                submitRename(title, close);
              }}
            >
              <div className="flex items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
                <Pencil className="size-3.5" />
                <span>Rename terminal</span>
              </div>
              <Input
                value={renameDraft}
                maxLength={160}
                onChange={(event) => setRenameDraft(event.target.value)}
                className="h-8 text-xs"
                data-right-panel-tab-no-drag="true"
                autoFocus
              />
              <div className="flex items-center justify-end gap-1">
                <PopoverMenuItem
                  label="Close"
                  type="button"
                  icon={<X className="size-3.5" />}
                  disabled={!isRuntimeReady}
                  className="h-8 px-2 py-0 text-xs text-destructive"
                  onClick={() => {
                    close();
                    onClose();
                  }}
                />
                <PopoverMenuItem
                  label="Save"
                  type="submit"
                  disabled={renaming || !renameDraft.trim()}
                  className="h-8 justify-center px-3 py-0 text-xs"
                />
              </div>
            </form>
          )}
        </PopoverButton>
        <div
          className="ui-tab-system-tab__close-container"
          data-right-panel-tab-no-drag="true"
        >
          <IconButton
            size="xs"
            tone="sidebar"
            title={`Close ${displayTitle}`}
            disabled={!isRuntimeReady}
            className="ui-icon-button ui-tab-system-tab__close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="ui-icon" />
          </IconButton>
        </div>
      </div>
    </Tooltip>
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
