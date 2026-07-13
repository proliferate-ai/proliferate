import { RightPanelHeaderEntryDropZone } from "@/components/workspace/shell/right-panel/RightPanelHeaderEntryDropZone";
import { TerminalHeaderButton } from "@/components/workspace/shell/right-panel/TerminalHeaderButton";
import { ToolHeaderButton } from "@/components/workspace/shell/right-panel/ToolHeaderButton";
import { ViewerHeaderButton } from "@/components/workspace/shell/right-panel/ViewerHeaderButton";
import type { RightPanelHeaderDragController } from "@/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  terminalHeaderDisplayTitle,
  type RightPanelHeaderEntry,
} from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type {
  RightPanelHeaderEntryKey,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
  type FileViewerMode,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

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
  return (
    <>
      {entries.map((entry) => {
        const dragState = drag.getEntryDragState(entry.key);

        if (entry.kind === "tool") {
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
              <ToolHeaderButton
                tool={entry.tool}
                isActive={activeEntryKey === entry.key}
                isDragging={drag.draggedHeaderKey === entry.key}
                shouldSuppressClick={drag.shouldSuppressHeaderClick}
                onSelect={() => {
                  onActivateEntry(entry.key);
                }}
              />
            </RightPanelHeaderEntryDropZone>
          );
        }

        if (entry.kind === "terminal") {
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
              <TerminalHeaderButton
                terminalId={entry.terminalId}
                terminal={entry.terminal}
                displayTitle={terminalHeaderDisplayTitle(entries, entry)}
                isActive={activeEntryKey === entry.key}
                unread={unreadByTerminal[entry.terminalId] === true}
                isRuntimeReady={isWorkspaceReady && Boolean(entry.terminal)}
                isDragging={drag.draggedHeaderKey === entry.key}
                shouldSuppressClick={drag.shouldSuppressHeaderClick}
                shortcutLabel={isWorkspaceReady
                  ? getShortcutDisplayLabel(SHORTCUTS.openTerminal)
                  : null}
                shortcutRevealVisible={shortcutRevealVisible}
                onSelect={() => {
                  onActivateEntry(entry.key);
                }}
                onClose={() => onCloseTerminal(entry.terminalId)}
                onRename={(title) => onRenameTerminal(entry.terminalId, title)}
              />
            </RightPanelHeaderEntryDropZone>
          );
        }

        const targetKey = viewerTargetKey(entry.target);
        const editablePath = viewerTargetEditablePath(entry.target);
        const buffer = editablePath ? buffersByPath[editablePath] : null;
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
            <ViewerHeaderButton
              target={entry.target}
              isActive={activeEntryKey === entry.key}
              isDirty={buffer?.isDirty ?? false}
              isDiff={tabModes[targetKey] === "diff" || entry.target.kind === "fileDiff"}
              isDragging={drag.draggedHeaderKey === entry.key}
              shouldSuppressClick={drag.shouldSuppressHeaderClick}
              onSelect={() => {
                onActivateEntry(entry.key);
              }}
              onClose={() => onCloseViewerTarget(targetKey)}
            />
          </RightPanelHeaderEntryDropZone>
        );
      })}
    </>
  );
}
