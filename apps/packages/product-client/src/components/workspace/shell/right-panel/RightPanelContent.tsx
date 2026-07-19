import { FileEditorView } from "#product/components/workspace/files/FileEditorView";
import { PromptAttachmentViewer } from "#product/components/workspace/files/PromptAttachmentViewer";
import { GitPanel } from "#product/components/workspace/git/GitPanel";
import { ScratchPadPanel } from "#product/components/workspace/scratch/ScratchPadPanel";
import { RightPanelPlaceholder } from "#product/components/workspace/shell/right-panel/RightPanelPlaceholder";
import { TerminalPanel } from "#product/components/workspace/terminals/TerminalPanel";
import { TERMINAL_GRID_PROBE_ATTRIBUTE } from "#product/lib/infra/terminals/terminal-grid-probe";
import type { TerminalRecord } from "@anyharness/sdk";
import type {
  RightPanelActiveEntryKey,
  RightPanelTool,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  viewerTargetKey,
  type ViewerTarget,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

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
              {activeViewerTarget.kind === "promptAttachment" ? (
                <PromptAttachmentViewer target={activeViewerTarget} />
              ) : activeViewerTarget.kind === "file" ? (
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
