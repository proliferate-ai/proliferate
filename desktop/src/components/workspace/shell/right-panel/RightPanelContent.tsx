import { WorkspaceBrowserPanel } from "@/components/workspace/browser/WorkspaceBrowserPanel";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { RightPanelPlaceholder } from "@/components/workspace/shell/right-panel/RightPanelPlaceholder";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import type { TerminalRecord } from "@anyharness/sdk";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel";
import type { RightPanelActiveEntryKey, RightPanelTool } from "@/lib/domain/workspaces/shell/right-panel";

interface RightPanelContentProps {
  workspaceId: string | null;
  activeEntryKey: RightPanelActiveEntryKey;
  activeTool: RightPanelTool | null;
  activeBrowserId: string | null;
  activeTerminalId: string | null;
  browserTabs: readonly RightPanelBrowserTab[];
  orderedTerminals: readonly TerminalRecord[];
  shouldRenderContent: boolean;
  shouldMountBrowserPanel: boolean;
  shouldMountTerminalPanel: boolean;
  isOpen: boolean;
  isWorkspaceReady: boolean;
  canConnectTerminals: boolean;
  isLoadingTerminals: boolean;
  terminalListErrorMessage: string | null;
  terminalFocusRequestToken: number;
  unreadByTerminal: Record<string, boolean>;
  nativeOverlaysHidden: boolean;
  onUpdateBrowserUrl: (browserId: string, url: string) => void;
  onNewTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
}

export function RightPanelContent({
  workspaceId,
  activeEntryKey,
  activeTool,
  activeBrowserId,
  activeTerminalId,
  browserTabs,
  orderedTerminals,
  shouldRenderContent,
  shouldMountBrowserPanel,
  shouldMountTerminalPanel,
  isOpen,
  isWorkspaceReady,
  canConnectTerminals,
  isLoadingTerminals,
  terminalListErrorMessage,
  terminalFocusRequestToken,
  unreadByTerminal,
  nativeOverlaysHidden,
  onUpdateBrowserUrl,
  onNewTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
}: RightPanelContentProps) {
  return (
    <div
      data-panel="true"
      id="workspace-side-panel"
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      {!shouldRenderContent ? (
        <RightPanelPlaceholder activeEntryKey={activeEntryKey} />
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
          {shouldMountBrowserPanel && (
            <div className={activeBrowserId ? "absolute inset-0" : "hidden"}>
              <WorkspaceBrowserPanel
                workspaceId={workspaceId}
                tabs={browserTabs}
                activeBrowserId={activeBrowserId}
                isVisible={isOpen && activeBrowserId !== null}
                nativeOverlaysHidden={nativeOverlaysHidden}
                onUpdateUrl={onUpdateBrowserUrl}
              />
            </div>
          )}
          {shouldMountTerminalPanel && (
            <div className={activeTerminalId ? "absolute inset-0" : "hidden"}>
              <TerminalPanel
                workspaceId={workspaceId}
                terminals={orderedTerminals}
                activeTerminalId={activeTerminalId}
                isVisible={activeTerminalId !== null}
                isRuntimeReady={isWorkspaceReady}
                canConnect={canConnectTerminals}
                isLoading={isLoadingTerminals}
                errorMessage={terminalListErrorMessage}
                focusRequestToken={terminalFocusRequestToken}
                unreadByTerminal={unreadByTerminal}
                onNewTerminal={onNewTerminal}
                onSelectTerminal={onSelectTerminal}
                onCloseTerminal={onCloseTerminal}
                onRenameTerminal={onRenameTerminal}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
