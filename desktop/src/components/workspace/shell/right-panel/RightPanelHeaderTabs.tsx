import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { IconButton } from "@/components/ui/IconButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Plus,
  Settings,
  Terminal as TerminalIcon,
  Globe,
} from "@/components/ui/icons";
import {
  browserTabTitle,
  type RightPanelBrowserTab,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/right-panel";
import { ToolHeaderButton } from "@/components/workspace/shell/right-panel/ToolHeaderButton";
import { TerminalHeaderButton } from "@/components/workspace/shell/right-panel/TerminalHeaderButton";
import { BrowserHeaderButton } from "@/components/workspace/shell/right-panel/BrowserHeaderButton";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

const HEADER_DRAG_THRESHOLD_PX = 4;

export type HeaderEntry =
  | { kind: "tool"; key: RightPanelHeaderEntryKey; tool: RightPanelTool }
  | { kind: "terminal"; key: RightPanelHeaderEntryKey; terminalId: string; terminal: TerminalRecord | null }
  | { kind: "browser"; key: RightPanelHeaderEntryKey; tab: RightPanelBrowserTab };

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
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  newTabMenuRequestToken: number;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectBrowser: (browserId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseBrowser: (browserId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenRepoSettings: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}

export function RightPanelHeaderTabs({
  entries,
  activeEntryKey,
  unreadByTerminal,
  isWorkspaceReady,
  canCreateBrowserTab,
  newTabMenuRequestToken,
  newTabMenuDefaultKind,
  onActivateTool,
  onSelectTerminal,
  onSelectBrowser,
  onCloseTerminal,
  onCloseBrowser,
  onRenameTerminal,
  onCreateTerminal,
  onCreateBrowser,
  onOpenRepoSettings,
  onReorderHeaderEntry,
}: RightPanelHeaderTabsProps) {
  const [headerDragPreview, setHeaderDragPreview] = useState<HeaderDragPreview | null>(null);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const draggedHeaderKey = headerDragPreview?.key ?? null;
  const headerEntryNodesRef = useRef(new Map<RightPanelHeaderEntryKey, HTMLDivElement>());
  const headerDragSessionRef = useRef<HeaderDragSession | null>(null);
  const suppressNextHeaderClickRef = useRef(false);

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

  useEffect(() => {
    if (newTabMenuRequestToken > 0) {
      setNewTabMenuOpen(true);
    }
  }, [newTabMenuRequestToken]);

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
                    const isActive = activeEntryKey === entry.key;
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
                        <ToolHeaderButton
                          tool={entry.tool}
                          isActive={isActive}
                          isDragging={draggedHeaderKey === entry.key}
                          shouldSuppressClick={shouldSuppressHeaderClick}
                          onSelect={() => onActivateTool(entry.tool)}
                        />
                      </RightPanelHeaderEntryDropZone>
                    );
                  }

                  if (entry.kind === "terminal") {
                    const terminalIndex = entries
                      .filter((candidate) => candidate.kind === "terminal")
                      .findIndex((candidate) =>
                        candidate.kind === "terminal" && candidate.terminalId === entry.terminalId
                      );
                    const isActive = activeEntryKey === entry.key;
                    const fallbackTitle = `Terminal ${terminalIndex + 1}`;
                    const displayTitle = entry.terminal?.title === "Terminal"
                      ? fallbackTitle
                      : entry.terminal?.title ?? fallbackTitle;
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
                        <TerminalHeaderButton
                          terminalId={entry.terminalId}
                          terminal={entry.terminal}
                          displayTitle={displayTitle}
                          isActive={isActive}
                          unread={unreadByTerminal[entry.terminalId] === true}
                          isRuntimeReady={isWorkspaceReady && Boolean(entry.terminal)}
                          isDragging={draggedHeaderKey === entry.key}
                          shouldSuppressClick={shouldSuppressHeaderClick}
                          onSelect={() => onSelectTerminal(entry.terminalId)}
                          onClose={() => onCloseTerminal(entry.terminalId)}
                          onRename={(title) => onRenameTerminal(entry.terminalId, title)}
                        />
                      </RightPanelHeaderEntryDropZone>
                    );
                  }

                  const browserIndex = entries
                    .filter((candidate) => candidate.kind === "browser")
                    .findIndex((candidate) =>
                      candidate.kind === "browser" && candidate.tab.id === entry.tab.id
                    );
                  const isActive = activeEntryKey === entry.key;
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
                      <BrowserHeaderButton
                        browserId={entry.tab.id}
                        displayTitle={browserTabTitle(entry.tab, browserIndex)}
                        isActive={isActive}
                        isDragging={draggedHeaderKey === entry.key}
                        shouldSuppressClick={shouldSuppressHeaderClick}
                        onSelect={() => onSelectBrowser(entry.tab.id)}
                        onClose={() => onCloseBrowser(entry.tab.id)}
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
              singleLine
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
                externalOpen={newTabMenuOpen}
                onOpenChange={setNewTabMenuOpen}
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
                  <NewTabMenuContent
                    defaultKind={newTabMenuDefaultKind}
                    isWorkspaceReady={isWorkspaceReady}
                    canCreateBrowserTab={canCreateBrowserTab}
                    onCreateTerminal={() => {
                      close();
                      onCreateTerminal();
                    }}
                    onCreateBrowser={() => {
                      close();
                      onCreateBrowser();
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

function NewTabMenuContent({
  defaultKind,
  isWorkspaceReady,
  canCreateBrowserTab,
  onCreateTerminal,
  onCreateBrowser,
}: {
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
}) {
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    )];
    if (buttons.length === 0) {
      return;
    }

    const activeButton = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
    const currentIndex = activeButton ? buttons.indexOf(activeButton) : -1;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
    event.preventDefault();
  }, []);

  return (
    <div onKeyDown={handleKeyDown}>
      <PopoverMenuItem
        label="Terminal"
        variant="sidebar"
        icon={<TerminalIcon className="size-4" />}
        disabled={!isWorkspaceReady}
        autoFocus={defaultKind === "terminal"}
        onClick={onCreateTerminal}
      />
      <PopoverMenuItem
        label="Browser"
        variant="sidebar"
        icon={<Globe className="size-4" />}
        disabled={!isWorkspaceReady || !canCreateBrowserTab}
        autoFocus={defaultKind === "browser"}
        onClick={onCreateBrowser}
      />
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
