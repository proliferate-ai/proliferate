import type {
  PointerEventHandler,
  RefObject,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { RightPanelContent } from "@/components/workspace/shell/right-panel/RightPanelContent";
import { RightPanelHeaderTabs } from "@/components/workspace/shell/right-panel/RightPanelHeaderTabs";
import type {
  RightPanelActiveEntryKey,
  RightPanelHeaderEntryKey,
  RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";
import type {
  FileViewerMode,
  ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";

interface RightPanelFrameProps {
  rootRef: RefObject<HTMLDivElement | null>;
  onPointerDownCapture: PointerEventHandler<HTMLDivElement>;
  workspaceId: string | null;
  workspaceUiKey: string | null;
  activeEntryKey: RightPanelActiveEntryKey;
  activeTool: RightPanelTool | null;
  activeTerminalId: string | null;
  activeViewerTarget: ViewerTarget | null;
  entries: readonly RightPanelHeaderEntry[];
  unreadByTerminal: Record<string, boolean>;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, FileViewerMode>;
  orderedTerminals: readonly TerminalRecord[];
  isWorkspaceReady: boolean;
  shouldRenderContent: boolean;
  shouldMountTerminalPanel: boolean;
  canConnectTerminals: boolean;
  isLoadingTerminals: boolean;
  terminalListErrorMessage: string | null;
  terminalFocusRequestToken: number;
  newTabMenuRequestToken: number;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  onActivateEntry: (entryKey: RightPanelHeaderEntryKey) => boolean;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onOpenRepoSettings: () => void;
  onTogglePanel: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}

export function RightPanelFrame({
  rootRef,
  onPointerDownCapture,
  workspaceId,
  workspaceUiKey,
  activeEntryKey,
  activeTool,
  activeTerminalId,
  activeViewerTarget,
  entries,
  unreadByTerminal,
  buffersByPath,
  tabModes,
  orderedTerminals,
  isWorkspaceReady,
  shouldRenderContent,
  shouldMountTerminalPanel,
  canConnectTerminals,
  isLoadingTerminals,
  terminalListErrorMessage,
  terminalFocusRequestToken,
  newTabMenuRequestToken,
  newTabMenuDefaultKind,
  onActivateEntry,
  onSelectTerminal,
  onCloseTerminal,
  onCloseViewerTarget,
  onRenameTerminal,
  onCreateTerminal,
  onOpenRepoSettings,
  onTogglePanel,
  onReorderHeaderEntry,
}: RightPanelFrameProps) {
  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-focus-zone="right-panel"
      data-group="true"
      tabIndex={-1}
      onPointerDownCapture={onPointerDownCapture}
      className="relative flex h-full flex-col overflow-hidden border-l border-t border-sidebar-border bg-sidebar-background text-sidebar-foreground shadow-[-8px_0_16px_-8px_color-mix(in_oklab,var(--color-overlay)_16%,transparent)] outline-none"
    >
      <RightPanelHeaderTabs
        entries={entries}
        activeEntryKey={activeEntryKey}
        unreadByTerminal={unreadByTerminal}
        buffersByPath={buffersByPath}
        tabModes={tabModes}
        isWorkspaceReady={isWorkspaceReady}
        newTabMenuRequestToken={newTabMenuRequestToken}
        newTabMenuDefaultKind={newTabMenuDefaultKind}
        onActivateEntry={onActivateEntry}
        onCloseTerminal={onCloseTerminal}
        onCloseViewerTarget={onCloseViewerTarget}
        onRenameTerminal={onRenameTerminal}
        onCreateTerminal={onCreateTerminal}
        onReorderHeaderEntry={onReorderHeaderEntry}
        onOpenRepoSettings={onOpenRepoSettings}
        onTogglePanel={onTogglePanel}
      />

      <RightPanelContent
        workspaceId={workspaceId}
        workspaceUiKey={workspaceUiKey}
        activeEntryKey={activeEntryKey}
        activeTool={activeTool}
        activeTerminalId={activeTerminalId}
        activeViewerTarget={activeViewerTarget}
        orderedTerminals={orderedTerminals}
        shouldRenderContent={shouldRenderContent}
        shouldMountTerminalPanel={shouldMountTerminalPanel}
        isWorkspaceReady={isWorkspaceReady}
        canConnectTerminals={canConnectTerminals}
        isLoadingTerminals={isLoadingTerminals}
        terminalListErrorMessage={terminalListErrorMessage}
        terminalFocusRequestToken={terminalFocusRequestToken}
        unreadByTerminal={unreadByTerminal}
        onNewTerminal={onCreateTerminal}
        onSelectTerminal={onSelectTerminal}
        onCloseTerminal={onCloseTerminal}
        onRenameTerminal={onRenameTerminal}
      />
    </div>
  );
}
