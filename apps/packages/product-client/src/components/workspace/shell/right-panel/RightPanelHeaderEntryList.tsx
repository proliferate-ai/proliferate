import type { ComponentType } from "react";
import { PanelHeaderEntry } from "#product/primitives/patterns/panel/PanelHeaderEntry";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import {
  AppShellReviewIcon,
  AppShellTabCloseIcon,
  AppShellTerminalIcon,
} from "#product/primitives/icons/app-shell";
import { Fork } from "#product/primitives/icons/core";
import { UsersRound } from "#product/primitives/icons/platform";
import { ScratchPadIcon } from "#product/primitives/icons/product";
import { SquareTerminal } from "#product/primitives/icons/workspace";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import type { IconProps } from "#product/primitives/icons/types";
import { RightPanelHeaderEntryDropZone } from "#product/components/workspace/shell/right-panel/RightPanelHeaderEntryDropZone";
import { TerminalHeaderIcon } from "#product/components/workspace/shell/right-panel/TerminalHeaderIcon";
import type { RightPanelHeaderDragController } from "#product/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  terminalHeaderDisplayTitle,
  type RightPanelHeaderEntry,
} from "#product/lib/domain/workspaces/shell/right-panel-header-entry";
import type {
  RightPanelHeaderEntryKey,
  RightPanelTool,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  viewerTargetDisplayPath,
  viewerTargetEditablePath,
  viewerTargetKey,
  viewerTargetLabel,
  type FileViewerMode,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "#product/stores/editor/workspace-file-buffers-store";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";

interface ToolConfig {
  label: string;
  icon: ComponentType<IconProps>;
}

const PANEL_TOOLS: Record<RightPanelTool, ToolConfig> = {
  scratch: { label: "Scratch", icon: ScratchPadIcon },
  git: { label: "Changes", icon: AppShellReviewIcon },
  agents: { label: "Agents", icon: UsersRound },
  // `SquareTerminal`, not `Fork`: `Fork` is already the execution tab's
  // concept-glyph (see the workflow entry below), and the background-work
  // roster is mostly terminals + subagent processes — `TerminalRosterRow`
  // already uses this exact glyph for a background process row, so the tab
  // and its rows agree on the concept's mark.
  background: { label: "Background work", icon: SquareTerminal },
  // The `Fork` mark, not the `Workflow` tile: the execution tab is the same
  // concept the sidebar's Workflows nav row carries, and that row already
  // settled on `Fork` — one glyph per concept, wherever it appears.
  workflow: { label: WORKFLOW_RUN_VIEW_COPY.paneTitle, icon: Fork },
};

interface RightPanelHeaderEntryListProps {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, FileViewerMode>;
  isWorkspaceReady: boolean;
  drag: RightPanelHeaderDragController;
  shortcutRevealVisible: boolean;
  onActivateEntry: (entryKey: RightPanelHeaderEntryKey) => boolean;
  onCloseTerminal: (terminalId: string) => void;
  onCloseViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
}

export function RightPanelHeaderEntryList({
  entries,
  activeEntryKey,
  unreadByTerminal,
  buffersByPath,
  tabModes,
  isWorkspaceReady,
  drag,
  shortcutRevealVisible,
  onActivateEntry,
  onCloseTerminal,
  onCloseViewerTarget,
  onRenameTerminal,
}: RightPanelHeaderEntryListProps) {
  // Roving-tabIndex floor (PanelHeaderEntry): when nothing in the strip is
  // active, the first entry absorbs tabIndex=0 so the strip stays
  // keyboard-reachable.
  const hasActiveEntry = entries.some((entry) => entry.key === activeEntryKey);
  const floorEntryKey = !hasActiveEntry ? entries[0]?.key : undefined;

  return (
    <>
      {entries.map((entry) => {
        const dragState = drag.getEntryDragState(entry.key);
        const isActive = activeEntryKey === entry.key;
        const isDragging = drag.draggedHeaderKey === entry.key;
        const tabIndexFloor = entry.key === floorEntryKey;

        if (entry.kind === "tool") {
          const panelTool = PANEL_TOOLS[entry.tool];
          const Icon = panelTool.icon;
          return (
            <RightPanelHeaderEntryDropZone
              key={entry.key}
              entryKey={entry.key}
              isDragging={dragState.isDragging}
              dragOffsetX={dragState.dragOffsetX}
              showDropIndicator={dragState.showDropIndicator}
              onRegister={drag.registerHeaderEntryNode}
              onPointerDown={drag.handleHeaderPointerDown}
              onPointerMove={drag.handleHeaderPointerMove}
              onPointerUp={drag.finishHeaderPointerDrag}
              onPointerCancel={drag.cancelHeaderPointerDrag}
            >
              <PanelHeaderEntry
                label={panelTool.label}
                icon={<Icon className="icon-control" />}
                active={isActive}
                tabIndexFloor={tabIndexFloor}
                controls={`tabpanel-workspace-right-panel-${entry.tool}`}
                data-reorderable="true"
                aria-grabbed={isDragging}
                onSelect={() => {
                  if (drag.shouldSuppressHeaderClick()) {
                    return;
                  }
                  onActivateEntry(entry.key);
                }}
              />
            </RightPanelHeaderEntryDropZone>
          );
        }

        if (entry.kind === "terminal") {
          const displayTitle = terminalHeaderDisplayTitle(entries, entry);
          const unread = unreadByTerminal[entry.terminalId] === true;
          const isRuntimeReady = isWorkspaceReady && Boolean(entry.terminal);
          const shortcutLabel = isWorkspaceReady
            ? getShortcutDisplayLabel(SHORTCUTS.openTerminal)
            : null;

          return (
            <RightPanelHeaderEntryDropZone
              key={entry.key}
              entryKey={entry.key}
              isDragging={dragState.isDragging}
              dragOffsetX={dragState.dragOffsetX}
              showDropIndicator={dragState.showDropIndicator}
              onRegister={drag.registerHeaderEntryNode}
              onPointerDown={drag.handleHeaderPointerDown}
              onPointerMove={drag.handleHeaderPointerMove}
              onPointerUp={drag.finishHeaderPointerDrag}
              onPointerCancel={drag.cancelHeaderPointerDrag}
            >
              {entry.terminal ? (
                <TerminalHeaderIcon
                  terminal={entry.terminal}
                  displayTitle={displayTitle}
                  isActive={isActive}
                  unread={unread}
                  isRuntimeReady={isRuntimeReady}
                  isDragging={isDragging}
                  tabIndexFloor={tabIndexFloor}
                  shouldSuppressClick={drag.shouldSuppressHeaderClick}
                  shortcutLabel={shortcutLabel}
                  shortcutRevealVisible={shortcutRevealVisible}
                  onSelect={() => onActivateEntry(entry.key)}
                  onClose={() => onCloseTerminal(entry.terminalId)}
                  onRename={(title) => onRenameTerminal(entry.terminalId, title)}
                />
              ) : (
                <PanelHeaderEntry
                  label={displayTitle}
                  icon={<AppShellTerminalIcon className="icon-control" />}
                  active={isActive}
                  dirty={unread}
                  tabIndexFloor={tabIndexFloor}
                  controls={`tabpanel-editor-panel-group-terminal-${entry.terminalId}`}
                  // `.right-panel-shortcut-badge` is absolutely positioned by
                  // product.css, so it contributes no width; the retired
                  // `[data-shortcut-reveal]` rule used to reserve room for it
                  // with `padding-right: 1.65rem`. Without that the badge
                  // overlays the label, so the reserve moves here as layout.
                  className={shortcutRevealVisible && shortcutLabel ? "pe-7" : ""}
                  trailing={shortcutRevealVisible && shortcutLabel ? (
                    <ShortcutBadge label={shortcutLabel} className="right-panel-shortcut-badge" />
                  ) : null}
                  data-reorderable="true"
                  aria-grabbed={isDragging}
                  data-dragging={isDragging ? true : undefined}
                  onSelect={() => {
                    if (drag.shouldSuppressHeaderClick()) {
                      return;
                    }
                    onActivateEntry(entry.key);
                  }}
                />
              )}
            </RightPanelHeaderEntryDropZone>
          );
        }

        const targetKey = viewerTargetKey(entry.target);
        const editablePath = viewerTargetEditablePath(entry.target);
        const buffer = editablePath ? buffersByPath[editablePath] : null;
        const displayPath = viewerTargetDisplayPath(entry.target);
        const label = viewerTargetLabel(entry.target);
        const title = displayPath ?? label;
        const isDirty = buffer?.isDirty ?? false;
        const isDiff = tabModes[targetKey] === "diff" || entry.target.kind === "fileDiff";

        return (
          <RightPanelHeaderEntryDropZone
            key={entry.key}
            entryKey={entry.key}
            isDragging={dragState.isDragging}
            dragOffsetX={dragState.dragOffsetX}
            showDropIndicator={dragState.showDropIndicator}
            onRegister={drag.registerHeaderEntryNode}
            onPointerDown={drag.handleHeaderPointerDown}
            onPointerMove={drag.handleHeaderPointerMove}
            onPointerUp={drag.finishHeaderPointerDrag}
            onPointerCancel={drag.cancelHeaderPointerDrag}
          >
            {/* `group` is load-bearing — see the note in TerminalHeaderIcon.tsx:
                RowActionIconButton's default hover-reveal is `opacity-0` +
                `group-hover:opacity-100` and needs a `group` ancestor. */}
            <div className="group right-panel-terminal-tab-shell">
              <PanelHeaderEntry
                label={label}
                title={title}
                icon={entry.target.kind === "allChanges" ? (
                  <AppShellReviewIcon className="icon-control" />
                ) : (
                  <FileTreeEntryIcon
                    name={label}
                    path={displayPath ?? label}
                    kind="file"
                    className="icon-control"
                  />
                )}
                active={isActive}
                dirty={isDirty}
                tabIndexFloor={tabIndexFloor}
                controls="tabpanel-workspace-right-panel-viewer"
                trailing={isDiff && entry.target.kind !== "allChanges" ? (
                  <span className="shrink-0 text-ui font-medium text-git-green">DIFF</span>
                ) : null}
                data-reorderable="true"
                aria-grabbed={isDragging}
                data-dragging={isDragging ? true : undefined}
                onSelect={() => {
                  if (drag.shouldSuppressHeaderClick()) {
                    return;
                  }
                  onActivateEntry(entry.key);
                }}
              />
              {/* Composed at the call site rather than via PanelHeaderEntry's
                  own onClose — see the note in TerminalHeaderIcon.tsx. */}
              <RowActionIconButton
                label={`Close ${label}`}
                data-right-panel-tab-no-drag="true"
                className="size-icon-button-sm rounded-full"
                onClick={() => onCloseViewerTarget(targetKey)}
              >
                <AppShellTabCloseIcon />
              </RowActionIconButton>
            </div>
          </RightPanelHeaderEntryDropZone>
        );
      })}
    </>
  );
}
