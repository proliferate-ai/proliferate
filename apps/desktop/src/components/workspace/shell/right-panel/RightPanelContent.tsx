import { FileEditorView } from "@/components/workspace/files/FileEditorView";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { ScratchPadPanel } from "@/components/workspace/scratch/ScratchPadPanel";
import { RightPanelPlaceholder } from "@/components/workspace/shell/right-panel/RightPanelPlaceholder";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { TERMINAL_GRID_PROBE_ATTRIBUTE } from "@/lib/infra/terminals/terminal-grid-probe";
import type { TerminalRecord } from "@anyharness/sdk";
import type {
  RightPanelActiveEntryKey,
  RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  viewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";

interface RightPanelContentProps {
  workspaceId: string | null;
  workspaceUiKey: string | null;
  activeEntryKey: RightPanelActiveEntryKey;
  activeTool: RightPanelTool | null;
  activeTerminalId: string | null;
  activeViewerTarget: ViewerTarget | null;
  orderedTerminals: readonly TerminalRecord[];
  shouldRenderContent: boolean;
  shouldMountTerminalPanel: boolean;
  isWorkspaceReady: boolean;
  canConnectTerminals: boolean;
  isLoadingTerminals: boolean;
  terminalListErrorMessage: string | null;
  terminalFocusRequestToken: number;
  unreadByTerminal: Record<string, boolean>;
  onNewTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
}

export function RightPanelContent({
  workspaceId,
  workspaceUiKey,
  activeEntryKey,
  activeTool,
  activeTerminalId,
  activeViewerTarget,
  orderedTerminals,
  shouldRenderContent,
  shouldMountTerminalPanel,
  isWorkspaceReady,
  canConnectTerminals,
  isLoadingTerminals,
  terminalListErrorMessage,
  terminalFocusRequestToken,
  unreadByTerminal,
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
      {...(workspaceId ? { [TERMINAL_GRID_PROBE_ATTRIBUTE]: workspaceId } : {})}
    >
      {!shouldRenderContent ? (
        <RightPanelPlaceholder activeEntryKey={activeEntryKey} />
      ) : (
        <>
          {activeTool === "scratch" && (
            <div className="absolute inset-0">
              <ScratchPadPanel
                key={workspaceUiKey ?? "no-workspace"}
                workspaceKey={workspaceUiKey}
              />
            </div>
          )}
          {activeTool === "git" && (
            <div className="absolute inset-0">
              <GitPanel />
            </div>
          )}
          {activeViewerTarget && (
            <div className="absolute inset-0">
              {activeViewerTarget.kind === "file" ? (
                <FileEditorView
                  filePath={activeViewerTarget.path}
                  targetKey={viewerTargetKey(activeViewerTarget)}
                />
              ) : activeViewerTarget.kind === "fileDiff" ? (
                <FileEditorView
                  filePath={activeViewerTarget.path}
                  targetKey={viewerTargetKey(activeViewerTarget)}
                  diffTarget={activeViewerTarget}
                />
              ) : (
                <GitPanel />
              )}
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
                showHeader={false}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
