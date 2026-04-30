import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  FileIcon,
  GitBranchIcon,
  Plus,
  Settings,
  CloudIcon,
  Terminal as TerminalIcon,
  type IconProps,
} from "@/components/ui/icons";
import {
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/right-panel";
import { TerminalHeaderIcon } from "@/components/workspace/shell/right-panel/TerminalHeaderIcon";

interface PanelToolConfig {
  id: RightPanelTool;
  label: string;
  icon: ComponentType<IconProps>;
}

const PANEL_TOOLS: Record<RightPanelTool, PanelToolConfig> = {
  files: { id: "files", label: "Files", icon: FileIcon },
  git: { id: "git", label: "Git", icon: GitBranchIcon },
  settings: { id: "settings", label: "Cloud environment", icon: CloudIcon },
  terminal: { id: "terminal", label: "Terminal", icon: TerminalIcon },
};

const HEADER_STABLE_TAB_CLASS = "ui-tab-system-tab";
const HEADER_DRAG_THRESHOLD_PX = 4;

export type HeaderEntry =
  | { kind: "tool"; key: RightPanelHeaderEntryKey; tool: RightPanelTool }
  | { kind: "terminal"; key: RightPanelHeaderEntryKey; terminal: TerminalRecord };

interface HeaderDragSession {
  key: RightPanelHeaderEntryKey;
  pointerId: number;
  startX: number;
  startY: number;
  beforeKey: RightPanelHeaderEntryKey | null;
  isDragging: boolean;
}

interface HeaderDragPreview {
  key: RightPanelHeaderEntryKey;
  offsetX: number;
  beforeKey: RightPanelHeaderEntryKey | null;
}

interface RightPanelHeaderTabsProps {
  entries: readonly HeaderEntry[];
  activeTool: RightPanelTool;
  activeTerminalId: string | null;
  orderedTerminals: readonly TerminalRecord[];
  unreadByTerminal: Record<string, boolean>;
  isWorkspaceReady: boolean;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onOpenRepoSettings: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}

export function RightPanelHeaderTabs({
  entries,
  activeTool,
  activeTerminalId,
  orderedTerminals,
  unreadByTerminal,
  isWorkspaceReady,
  onActivateTool,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onCreateTerminal,
  onOpenRepoSettings,
  onReorderHeaderEntry,
}: RightPanelHeaderTabsProps) {
  const [headerDragPreview, setHeaderDragPreview] = useState<HeaderDragPreview | null>(null);
  const draggedHeaderKey = headerDragPreview?.key ?? null;
  const headerEntryNodesRef = useRef(new Map<RightPanelHeaderEntryKey, HTMLDivElement>());
  const headerDragSessionRef = useRef<HeaderDragSession | null>(null);
  const suppressNextHeaderClickRef = useRef(false);
  const terminalIndexesById = useMemo(
    () => new Map(orderedTerminals.map((terminal, index) => [terminal.id, index])),
    [orderedTerminals],
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
      beforeKey: null,
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
    }

    event.preventDefault();
    const beforeKey = resolveHeaderDropBeforeKey(event.clientX, session.key);
    session.beforeKey = beforeKey;
    setHeaderDragPreview({
      key: session.key,
      offsetX: event.clientX - session.startX,
      beforeKey,
    });
  }, [resolveHeaderDropBeforeKey]);

  const finishHeaderPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (session.isDragging) {
      event.preventDefault();
      onReorderHeaderEntry(session.key, session.beforeKey);
      suppressNextHeaderClick();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    headerDragSessionRef.current = null;
    setHeaderDragPreview(null);
  }, [onReorderHeaderEntry, suppressNextHeaderClick]);

  const cancelHeaderPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    headerDragSessionRef.current = null;
    setHeaderDragPreview(null);
  }, []);

  return (
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
                {entries.map((entry) => {
                  if (entry.kind === "tool") {
                    const panelTool = PANEL_TOOLS[entry.tool];
                    const Icon = panelTool.icon;
                    const isActive = activeTool === entry.tool;
                    const isEntryDragging = headerDragPreview?.key === entry.key;
                    return (
                      <RightPanelHeaderEntryDropZone
                        key={entry.key}
                        entryKey={entry.key}
                        isDragging={isEntryDragging}
                        dragOffsetX={isEntryDragging ? headerDragPreview.offsetX : 0}
                        showDropIndicator={headerDragPreview?.beforeKey === entry.key}
                        onRegister={registerHeaderEntryNode}
                        onPointerDown={handleHeaderPointerDown}
                        onPointerMove={handleHeaderPointerMove}
                        onPointerUp={finishHeaderPointerDrag}
                        onPointerCancel={cancelHeaderPointerDrag}
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
                              onActivateTool(entry.tool);
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
                  const terminalIndex = terminalIndexesById.get(terminal.id) ?? 0;
                  const isActive = activeTool === "terminal" && terminal.id === activeTerminalId;
                  const fallbackTitle = `Terminal ${terminalIndex + 1}`;
                  const displayTitle = terminal.title === "Terminal"
                    ? fallbackTitle
                    : terminal.title;
                  const isEntryDragging = headerDragPreview?.key === entry.key;
                  return (
                    <RightPanelHeaderEntryDropZone
                      key={entry.key}
                      entryKey={entry.key}
                      isDragging={isEntryDragging}
                      dragOffsetX={isEntryDragging ? headerDragPreview.offsetX : 0}
                      showDropIndicator={headerDragPreview?.beforeKey === entry.key}
                      onRegister={registerHeaderEntryNode}
                      onPointerDown={handleHeaderPointerDown}
                      onPointerMove={handleHeaderPointerMove}
                      onPointerUp={finishHeaderPointerDrag}
                      onPointerCancel={cancelHeaderPointerDrag}
                    >
                      <TerminalHeaderIcon
                        terminal={terminal}
                        displayTitle={displayTitle}
                        isActive={isActive}
                        unread={unreadByTerminal[terminal.id] === true}
                        isRuntimeReady={isWorkspaceReady}
                        isDragging={draggedHeaderKey === entry.key}
                        shouldSuppressClick={shouldSuppressHeaderClick}
                        onSelect={() => onSelectTerminal(terminal.id)}
                        onClose={() => onCloseTerminal(terminal.id)}
                        onRename={(title) => onRenameTerminal(terminal.id, title)}
                      />
                    </RightPanelHeaderEntryDropZone>
                  );
                })}

                <div
                  className="right-panel-tab-drop-target"
                  data-drop-before={headerDragPreview?.beforeKey === null ? true : undefined}
                />
              </div>
            </div>
            <div className="ui-tab-system-tabs__spacer" aria-hidden="true" />
          </div>
        </div>

        <div className="ui-tab-system-section ui-tab-system-section__trailing">
          <div className="editor-panel-overflow-action">
            <Tooltip
              content="Repo's settings"
              className="right-panel-repo-settings-tooltip"
            >
              <IconButton
                size="xs"
                tone="sidebar"
                title="Repo's settings"
                className="ui-icon-button glass-editor-panel-new-tab-menu-trigger"
                onClick={onOpenRepoSettings}
              >
                <Settings className="ui-icon" />
              </IconButton>
            </Tooltip>
          </div>
          <div className="editor-panel-overflow-action">
            <Tooltip
              content="Open new tab menu"
              className="right-panel-new-tab-tooltip"
              singleLine
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
                      onCreateTerminal();
                    }}
                  />
                )}
              </PopoverButton>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RightPanelHeaderEntryDropZoneProps {
  entryKey: RightPanelHeaderEntryKey;
  isDragging: boolean;
  dragOffsetX: number;
  showDropIndicator: boolean;
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
  dragOffsetX,
  showDropIndicator,
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
      data-drop-before={showDropIndicator ? true : undefined}
      style={isDragging ? { transform: `translateX(${dragOffsetX}px)` } : undefined}
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
