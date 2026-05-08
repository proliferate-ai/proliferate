import { BrowserHeaderButton } from "@/components/workspace/shell/right-panel/BrowserHeaderButton";
import { RightPanelHeaderEntryDropZone } from "@/components/workspace/shell/right-panel/RightPanelHeaderEntryDropZone";
import { TerminalHeaderButton } from "@/components/workspace/shell/right-panel/TerminalHeaderButton";
import { ToolHeaderButton } from "@/components/workspace/shell/right-panel/ToolHeaderButton";
import type { RightPanelHeaderDragController } from "@/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  browserHeaderDisplayTitle,
  terminalHeaderDisplayTitle,
  type RightPanelHeaderEntry,
} from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type {
  RightPanelHeaderEntryKey,
  RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel";

interface RightPanelHeaderEntryListProps {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  isWorkspaceReady: boolean;
  drag: RightPanelHeaderDragController;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectBrowser: (browserId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseBrowser: (browserId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
}

export function RightPanelHeaderEntryList({
  entries,
  activeEntryKey,
  unreadByTerminal,
  isWorkspaceReady,
  drag,
  onActivateTool,
  onSelectTerminal,
  onSelectBrowser,
  onCloseTerminal,
  onCloseBrowser,
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
