import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { WorkspaceContentView } from "@/components/workspace/shell/WorkspaceContentView";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { HomeScreen } from "@/components/home/HomeScreen";
import { CommitDialog } from "@/components/workspace/git/CommitDialog";
import { PushDialog } from "@/components/workspace/git/PushDialog";
import { PullRequestDialog } from "@/components/workspace/git/PullRequestDialog";
import { WorkspaceFilePalette } from "@/components/workspace/files/palette/WorkspaceFilePalette";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { ArrowUp, Check, LoaderCircle, SplitPanel } from "@/components/ui/icons";
import { GlobalHeader } from "@/components/workspace/shell/GlobalHeader";
import { useMainScreenActions } from "@/hooks/main/use-main-screen-actions";
import { useMainScreenState } from "@/hooks/main/use-main-screen-state";
import { useWorkspaceShortcuts } from "@/hooks/shortcuts/use-workspace-shortcuts";
import { useUpdater, type UpdaterPhase } from "@/hooks/updater/use-updater";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";

export function MainScreen() {
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
  const {
    phase: updaterPhase,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  useWorkspaceShortcuts({
    onOpenFilePalette: actions.handleFilePaletteOpen,
  });

  return (
    <WorkspacePathProvider workspacePath={selectedWorkspace?.path ?? null}>
    <div className="h-screen flex overflow-hidden bg-sidebar" data-telemetry-block>
      {/* Sidebar column — full height, includes header area */}
      <div
        id="main-sidebar"
        className="flex shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-in-out"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        {/* Sidebar header — toggle button + traffic light space */}
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
        {/* Sidebar content */}
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

      {/* Main surface — header + content as one rounded block */}
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen ? "rounded-tl-lg" : ""}`}>
        {/* Header row */}
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
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

        {/* Content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {hasWorkspaceShell ? (
            <>
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
                />
                <WorkspaceContentView />
              </div>

              {hasWorkspaceShell && rightPanelOpen && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={onRightSeparatorDown}
                  className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -mr-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
                />
              )}
              {hasWorkspaceShell && (
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
              )}

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

interface SidebarUpdatePillProps {
  phase: UpdaterPhase;
  onDownloadUpdate: () => void | Promise<void>;
  onOpenRestartPrompt: () => void;
}

function SidebarUpdatePill({
  phase,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: SidebarUpdatePillProps) {
  const show = phase === "available" || phase === "downloading" || phase === "ready";
  if (!show) {
    return null;
  }

  const icon =
    phase === "downloading"
      ? <LoaderCircle className="size-3.5 animate-spin" />
      : phase === "ready"
        ? <Check className="size-3.5" />
        : <ArrowUp className="size-3.5" />;

  function handleClick() {
    if (phase === "available") {
      void onDownloadUpdate();
      return;
    }

    if (phase === "ready") {
      onOpenRestartPrompt();
    }
  }

  return (
    <Button
      variant="ghost"
      size="md"
      onClick={handleClick}
      disabled={phase === "downloading"}
      className="!h-7 !justify-start rounded-lg border border-border bg-secondary px-2.5 text-left text-secondary-foreground shadow-none transition-colors hover:bg-secondary/80 hover:text-secondary-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-secondary-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate text-[12px] font-normal text-secondary-foreground">
        Update
      </span>
    </Button>
  );
}
