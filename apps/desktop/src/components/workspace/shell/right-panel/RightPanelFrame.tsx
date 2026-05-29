import type {
  PointerEventHandler,
  RefObject,
} from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { RightPanelContent } from "@/components/workspace/shell/right-panel/RightPanelContent";
import { RightPanelHeaderTabs } from "@/components/workspace/shell/right-panel/RightPanelHeaderTabs";
import type {
  RightPanelActiveEntryKey,
  RightPanelBrowserTab,
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
  activeBrowserId: string | null;
  activeTerminalId: string | null;
  activeViewerTarget: ViewerTarget | null;
  entries: readonly RightPanelHeaderEntry[];
  unreadByTerminal: Record<string, boolean>;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, FileViewerMode>;
  browserTabs: readonly RightPanelBrowserTab[];
  orderedTerminals: readonly TerminalRecord[];
  isOpen: boolean;
  isWorkspaceReady: boolean;
  shouldRenderContent: boolean;
  shouldMountBrowserPanel: boolean;
  shouldMountTerminalPanel: boolean;
  canConnectTerminals: boolean;
  isLoadingTerminals: boolean;
  terminalListErrorMessage: string | null;
  terminalFocusRequestToken: number;
  newTabMenuRequestToken: number;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  nativeOverlaysHidden: boolean;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectBrowser: (browserId: string) => void;
  onSelectViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseBrowser: (browserId: string) => void;
  onCloseViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenRepoSettings: () => void;
  onTogglePanel: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
  onUpdateBrowserUrl: (browserId: string, url: string) => void;
}

export function RightPanelFrame({
  rootRef,
  onPointerDownCapture,
  workspaceId,
  workspaceUiKey,
  activeEntryKey,
  activeTool,
  activeBrowserId,
  activeTerminalId,
  activeViewerTarget,
  entries,
  unreadByTerminal,
  buffersByPath,
  tabModes,
  browserTabs,
  orderedTerminals,
  isOpen,
  isWorkspaceReady,
  shouldRenderContent,
  shouldMountBrowserPanel,
  shouldMountTerminalPanel,
  canConnectTerminals,
  isLoadingTerminals,
  terminalListErrorMessage,
  terminalFocusRequestToken,
  newTabMenuRequestToken,
  newTabMenuDefaultKind,
  nativeOverlaysHidden,
  onActivateTool,
  onSelectTerminal,
  onSelectBrowser,
  onSelectViewerTarget,
  onCloseTerminal,
  onCloseBrowser,
  onCloseViewerTarget,
  onRenameTerminal,
  onCreateTerminal,
  onCreateBrowser,
  onOpenRepoSettings,
  onTogglePanel,
  onReorderHeaderEntry,
  onUpdateBrowserUrl,
}: RightPanelFrameProps) {
  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-focus-zone="right-panel"
      data-group="true"
      tabIndex={-1}
      onPointerDownCapture={onPointerDownCapture}
      className="relative flex h-full flex-col overflow-hidden border-l border-t border-sidebar-border text-sidebar-foreground outline-none"
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
        onActivateTool={onActivateTool}
        onSelectTerminal={onSelectTerminal}
        onSelectBrowser={onSelectBrowser}
        onSelectViewerTarget={onSelectViewerTarget}
        onCloseTerminal={onCloseTerminal}
        onCloseBrowser={onCloseBrowser}
        onCloseViewerTarget={onCloseViewerTarget}
        onRenameTerminal={onRenameTerminal}
        onCreateTerminal={onCreateTerminal}
        onCreateBrowser={onCreateBrowser}
        onReorderHeaderEntry={onReorderHeaderEntry}
        onOpenRepoSettings={onOpenRepoSettings}
        onTogglePanel={onTogglePanel}
      />

      <RightPanelContent
        workspaceId={workspaceId}
        workspaceUiKey={workspaceUiKey}
        activeEntryKey={activeEntryKey}
        activeTool={activeTool}
        activeBrowserId={activeBrowserId}
        activeTerminalId={activeTerminalId}
        activeViewerTarget={activeViewerTarget}
        browserTabs={browserTabs}
        orderedTerminals={orderedTerminals}
        shouldRenderContent={shouldRenderContent}
        shouldMountBrowserPanel={shouldMountBrowserPanel}
        shouldMountTerminalPanel={shouldMountTerminalPanel}
        isOpen={isOpen}
        isWorkspaceReady={isWorkspaceReady}
        canConnectTerminals={canConnectTerminals}
        isLoadingTerminals={isLoadingTerminals}
        terminalListErrorMessage={terminalListErrorMessage}
        terminalFocusRequestToken={terminalFocusRequestToken}
        unreadByTerminal={unreadByTerminal}
        nativeOverlaysHidden={nativeOverlaysHidden}
        onUpdateBrowserUrl={onUpdateBrowserUrl}
        onNewTerminal={onCreateTerminal}
        onSelectTerminal={onSelectTerminal}
        onCloseTerminal={onCloseTerminal}
        onRenameTerminal={onRenameTerminal}
      />
    </div>
  );
}
