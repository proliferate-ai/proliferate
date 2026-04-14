import { HomeScreen } from "@/components/home/HomeScreen";
import { CommitDialog } from "@/components/workspace/git/CommitDialog";
import { PullRequestDialog } from "@/components/workspace/git/PullRequestDialog";
import { PushDialog } from "@/components/workspace/git/PushDialog";
import { WorkspaceFilePalette } from "@/components/workspace/files/palette/WorkspaceFilePalette";
import { GlobalHeader } from "@/components/workspace/shell/GlobalHeader";
import { WorkspaceContentView } from "@/components/workspace/shell/WorkspaceContentView";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { IconButton } from "@/components/ui/IconButton";
import { SplitPanel } from "@/components/ui/icons";
import { useMainScreenActions } from "@/hooks/main/use-main-screen-actions";
import { useMainScreenShortcuts } from "@/hooks/main/use-main-screen-shortcuts";
import { useMainScreenState } from "@/hooks/main/use-main-screen-state";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";
import { useUpdater } from "@/hooks/updater/use-updater";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";

const GLASS_HEADER_CLASS =
  "flex h-10 shrink-0 items-center border-b border-foreground/10 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20";
const SOLID_HEADER_CLASS = "flex h-10 shrink-0 items-center";

export function StandardWorkspaceShell() {
  const { layout, data } = useMainScreenState();
  const actions = useMainScreenActions({
    layout,
    existingPr: data.existingPr,
  });
  const {
    hasRuntimeReadyWorkspace,
    shouldKeepRuntimePanelsVisible,
    hasWorkspaceShell,
    isCloudWorkspaceSelected,
    selectedWorkspace,
    gitStatus,
    existingPr,
  } = data;
  const {
    sidebarOpen,
    sidebarWidth,
    rightPanelOpen,
    rightPanelMode,
    rightPanelWidth,
    commitOpen,
    pushOpen,
    prOpen,
    filePaletteOpen,
    onLeftSeparatorDown,
    onRightSeparatorDown,
  } = layout;
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const {
    phase: updaterPhase,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();

  useMainScreenShortcuts({
    onOpenFilePalette: actions.handleFilePaletteOpen,
  });

  return (
    <WorkspacePathProvider workspacePath={selectedWorkspace?.path ?? null}>
      <div
        className={`h-screen flex overflow-hidden ${
          transparentChromeEnabled ? "bg-transparent" : "bg-sidebar"
        }`}
        data-telemetry-block
      >
        <div
          id="main-sidebar"
          className="flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-150 ease-in-out"
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        >
          <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
            <div className="flex h-full items-center gap-2 pl-[82px]">
              <IconButton
                tone="sidebar"
                size="sm"
                onClick={actions.onToggleSidebar}
                title="Hide sidebar"
                className="rounded-md"
              >
                <SplitPanel className="size-4" />
              </IconButton>
              <SidebarUpdatePill
                phase={updaterPhase}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <MainSidebar />
          </div>
        </div>
        {sidebarOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-controls="main-sidebar"
            onMouseDown={onLeftSeparatorDown}
            className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -ml-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
          />
        )}

        <div
          className={`flex min-w-0 flex-1 flex-col overflow-hidden ${
            transparentChromeEnabled ? "bg-transparent" : "bg-background"
          } ${sidebarOpen ? "rounded-tl-lg" : ""}`}
        >
          <div
            className={transparentChromeEnabled ? GLASS_HEADER_CLASS : SOLID_HEADER_CLASS}
            data-tauri-drag-region="true"
          >
            {!sidebarOpen && (
              <div className="flex items-center gap-2 pl-[82px] pr-2">
                <IconButton
                  size="sm"
                  onClick={actions.onToggleSidebar}
                  title="Show sidebar"
                  className="rounded-md"
                >
                  <SplitPanel className="size-4" />
                </IconButton>
                <SidebarUpdatePill
                  phase={updaterPhase}
                  onDownloadUpdate={downloadUpdate}
                  onOpenRestartPrompt={openRestartPrompt}
                />
              </div>
            )}
            {hasWorkspaceShell && (
              <GlobalHeader
                branchName={gitStatus?.currentBranch ?? undefined}
                additions={gitStatus?.summary.additions}
                deletions={gitStatus?.summary.deletions}
                existingPr={existingPr}
                selectedWorkspace={selectedWorkspace}
                rightPanelOpen={rightPanelOpen}
                disableGitActions={!hasRuntimeReadyWorkspace}
                onTogglePanel={actions.toggleRightPanel}
                onCommit={actions.handleCommitOpen}
                onPush={actions.handlePushOpen}
                onCreatePr={actions.handlePrOpen}
                onViewPr={actions.handleViewPr}
                onRenameBranch={hasRuntimeReadyWorkspace ? actions.renameBranch : undefined}
                gitStatus={gitStatus ?? null}
              />
            )}
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
            {hasWorkspaceShell ? (
              <>
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
                  />
                  <WorkspaceContentView />
                </div>

                {rightPanelOpen && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={onRightSeparatorDown}
                    className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -mr-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
                  />
                )}
                <div
                  className="shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out"
                  style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
                >
                  <div className="h-full" style={{ minWidth: 260 }}>
                    <RightPanel
                      isWorkspaceReady={hasRuntimeReadyWorkspace}
                      shouldKeepContentVisible={shouldKeepRuntimePanelsVisible}
                      isCloudWorkspaceSelected={isCloudWorkspaceSelected}
                      mode={rightPanelMode}
                      onModeChange={actions.onSetRightPanelMode}
                    />
                  </div>
                </div>

                {hasRuntimeReadyWorkspace && (
                  <>
                    <CommitDialog
                      open={commitOpen}
                      onClose={actions.onCommitClose}
                      onOpenPrDialog={actions.openPrDialog}
                    />
                    <PushDialog
                      open={pushOpen}
                      onClose={actions.onPushClose}
                    />
                    <PullRequestDialog
                      open={prOpen}
                      onClose={actions.onPrClose}
                    />
                    <WorkspaceFilePalette
                      open={filePaletteOpen}
                      onClose={actions.onFilePaletteClose}
                    />
                  </>
                )}
              </>
            ) : (
              <HomeScreen />
            )}
          </div>
        </div>
      </div>
    </WorkspacePathProvider>
  );
}
