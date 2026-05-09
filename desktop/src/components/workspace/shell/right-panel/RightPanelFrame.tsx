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
} from "@/lib/domain/workspaces/shell/right-panel";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelFrameProps {
  rootRef: RefObject<HTMLDivElement | null>;
  onPointerDownCapture: PointerEventHandler<HTMLDivElement>;
  workspaceId: string | null;
  activeEntryKey: RightPanelActiveEntryKey;
  activeTool: RightPanelTool | null;
  activeBrowserId: string | null;
  activeTerminalId: string | null;
  entries: readonly RightPanelHeaderEntry[];
  unreadByTerminal: Record<string, boolean>;
  browserTabs: readonly RightPanelBrowserTab[];
  orderedTerminals: readonly TerminalRecord[];
  isOpen: boolean;
  isWorkspaceReady: boolean;
  shouldRenderContent: boolean;
  shouldMountBrowserPanel: boolean;
  shouldMountTerminalPanel: boolean;
  canCreateBrowserTab: boolean;
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
  onUpdateBrowserUrl: (browserId: string, url: string) => void;
}

export function RightPanelFrame({
  rootRef,
  onPointerDownCapture,
  workspaceId,
  activeEntryKey,
  activeTool,
  activeBrowserId,
  activeTerminalId,
  entries,
  unreadByTerminal,
  browserTabs,
  orderedTerminals,
  isOpen,
  isWorkspaceReady,
  shouldRenderContent,
  shouldMountBrowserPanel,
  shouldMountTerminalPanel,
  canCreateBrowserTab,
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
  onCloseTerminal,
  onCloseBrowser,
  onRenameTerminal,
  onCreateTerminal,
  onCreateBrowser,
  onOpenRepoSettings,
  onReorderHeaderEntry,
  onUpdateBrowserUrl,
}: RightPanelFrameProps) {
  return (
    <div
      ref={rootRef}
      data-right-panel-root="true"
      data-group="true"
      tabIndex={-1}
      onPointerDownCapture={onPointerDownCapture}
      className="relative flex h-full flex-col overflow-hidden rounded-tl-lg border-l border-t border-sidebar-border bg-sidebar-background outline-none"
    >
      <RightPanelHeaderTabs
        entries={entries}
        activeEntryKey={activeEntryKey}
        unreadByTerminal={unreadByTerminal}
        isWorkspaceReady={isWorkspaceReady}
        canCreateBrowserTab={canCreateBrowserTab}
        newTabMenuRequestToken={newTabMenuRequestToken}
        newTabMenuDefaultKind={newTabMenuDefaultKind}
        onActivateTool={onActivateTool}
        onSelectTerminal={onSelectTerminal}
        onSelectBrowser={onSelectBrowser}
        onCloseTerminal={onCloseTerminal}
        onCloseBrowser={onCloseBrowser}
        onRenameTerminal={onRenameTerminal}
        onCreateTerminal={onCreateTerminal}
        onCreateBrowser={onCreateBrowser}
        onReorderHeaderEntry={onReorderHeaderEntry}
        onOpenRepoSettings={onOpenRepoSettings}
      />

      <RightPanelContent
        workspaceId={workspaceId}
        activeEntryKey={activeEntryKey}
        activeTool={activeTool}
        activeBrowserId={activeBrowserId}
        activeTerminalId={activeTerminalId}
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
