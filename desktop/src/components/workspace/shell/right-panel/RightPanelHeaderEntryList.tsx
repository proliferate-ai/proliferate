import { BrowserHeaderButton } from "@/components/workspace/shell/right-panel/BrowserHeaderButton";
import { RightPanelHeaderEntryDropZone } from "@/components/workspace/shell/right-panel/RightPanelHeaderEntryDropZone";
import { TerminalHeaderButton } from "@/components/workspace/shell/right-panel/TerminalHeaderButton";
import { ToolHeaderButton } from "@/components/workspace/shell/right-panel/ToolHeaderButton";
import { ViewerHeaderButton } from "@/components/workspace/shell/right-panel/ViewerHeaderButton";
import type { RightPanelHeaderDragController } from "@/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  browserHeaderDisplayTitle,
  terminalHeaderDisplayTitle,
  type RightPanelHeaderEntry,
} from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type {
  RightPanelHeaderEntryKey,
  RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
  type FileViewerMode,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";

interface RightPanelHeaderEntryListProps {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, FileViewerMode>;
  isWorkspaceReady: boolean;
  drag: RightPanelHeaderDragController;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectBrowser: (browserId: string) => void;
  onSelectViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseBrowser: (browserId: string) => void;
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
  onActivateTool,
  onSelectTerminal,
  onSelectBrowser,
  onSelectViewerTarget,
  onCloseTerminal,
  onCloseBrowser,
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
                onSelect={() => onActivateTool(entry.tool)}
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
                onSelect={() => onSelectTerminal(entry.terminalId)}
                onClose={() => onCloseTerminal(entry.terminalId)}
                onRename={(title) => onRenameTerminal(entry.terminalId, title)}
              />
            </RightPanelHeaderEntryDropZone>
          );
        }

        if (entry.kind === "viewer") {
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
                onSelect={() => onSelectViewerTarget(targetKey)}
                onClose={() => onCloseViewerTarget(targetKey)}
              />
            </RightPanelHeaderEntryDropZone>
          );
        }

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
            <BrowserHeaderButton
              browserId={entry.tab.id}
              displayTitle={browserHeaderDisplayTitle(entries, entry)}
              isActive={activeEntryKey === entry.key}
              isDragging={drag.draggedHeaderKey === entry.key}
              shouldSuppressClick={drag.shouldSuppressHeaderClick}
              onSelect={() => onSelectBrowser(entry.tab.id)}
              onClose={() => onCloseBrowser(entry.tab.id)}
            />
          </RightPanelHeaderEntryDropZone>
        );
      })}
    </>
  );
}
