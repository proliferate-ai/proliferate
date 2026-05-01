import { HomeNextScreen } from "@/components/home/HomeNextScreen";
import { useEffect, useMemo } from "react";
import { PublishDialog } from "@/components/workspace/git/PublishDialog";
import { ConnectedReviewCritiqueDialog } from "@/components/workspace/reviews/ConnectedReviewCritiqueDialog";
import { ConnectedReviewSetupDialog } from "@/components/workspace/reviews/ConnectedReviewSetupDialog";
import { GlobalHeader } from "@/components/workspace/shell/GlobalHeader";
import { WorkspaceContentView } from "@/components/workspace/shell/WorkspaceContentView";
import { WorkspaceShellActionsProvider } from "@/components/workspace/shell/WorkspaceShellActionsContext";
import { WorkspaceCommandPalette } from "@/components/workspace/shell/command-palette/WorkspaceCommandPalette";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { IconButton } from "@/components/ui/IconButton";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { SplitPanel } from "@/components/ui/icons";
import { useMainScreenActions } from "@/hooks/main/use-main-screen-actions";
import { useMainScreenShortcuts } from "@/hooks/main/use-main-screen-shortcuts";
import { useMainScreenState } from "@/hooks/main/use-main-screen-state";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useUpdater } from "@/hooks/updater/use-updater";
import { useRunWorkspaceCommand } from "@/hooks/workspaces/use-run-workspace-command";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { resolveStandardWorkspaceChromeClasses } from "@/lib/domain/preferences/workspace-chrome";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";

export function StandardWorkspaceShell() {
  useDebugRenderCount("workspace-shell");
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
    selectedWorkspaceId,
    selectedWorkspace,
    selectedCloudWorkspace,
    gitStatus,
    existingPr,
  } = data;
  const {
    sidebarOpen,
    sidebarWidth,
    rightPanelOpen,
    rightPanelState,
    rightPanelWidth,
    terminalActivationRequestToken,
    publishDialog,
    commandPaletteOpen,
    onLeftSeparatorDown,
    onRightSeparatorDown,
  } = layout;
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const chromeClasses = resolveStandardWorkspaceChromeClasses({
    transparent: transparentChromeEnabled,
    sidebarOpen,
  });
  const activePublishWorkspaceId = selectedWorkspaceId;
  const publishSourceRootPath = publishDialog.open
    ? selectedWorkspace?.sourceRepoRootPath?.trim() || null
    : null;
  const publishRepoDefaultBranch = useRepoPreferencesStore((state) => (
    publishSourceRootPath
      ? state.repoConfigs[publishSourceRootPath]?.defaultBranch ?? null
      : null
  ));
  const {
    phase: updaterPhase,
    downloadProgress,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  const runCommand = useRunWorkspaceCommand({
    selectedWorkspaceId,
    selectedWorkspace,
    selectedCloudWorkspace,
    isRuntimeReady: hasRuntimeReadyWorkspace,
    openTerminalPanel: actions.openTerminalPanel,
  });
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const shellActions = useMemo(() => ({
    openTerminalPanel: actions.openTerminalPanel,
  }), [actions.openTerminalPanel]);
  const repoSettingsHref = useMemo(() => {
    const cloudOwner = selectedCloudWorkspace?.repo?.owner?.trim() ?? "";
    const cloudName = selectedCloudWorkspace?.repo?.name?.trim() ?? "";
    if (cloudOwner && cloudName) {
      return buildCloudRepoSettingsHref(cloudOwner, cloudName);
    }
    const localRepoPath = selectedWorkspace?.sourceRepoRootPath?.trim()
      || selectedWorkspace?.path?.trim()
      || "";
    if (!localRepoPath) {
      return null;
    }
    return buildSettingsHref({
      section: "repo",
      repo: localRepoPath,
    });
  }, [selectedCloudWorkspace?.repo?.name, selectedCloudWorkspace?.repo?.owner, selectedWorkspace]);
  const canOpenRepositorySettings = repoSettingsHref !== null;
  const repositorySettingsDisabledReason = canOpenRepositorySettings
    ? null
    : "Repository settings are unavailable.";

  useMainScreenShortcuts({
    canOpenCommandPalette: hasWorkspaceShell,
    onOpenCommandPalette: actions.handleCommandPaletteOpen,
    onOpenTerminal: actions.openTerminalPanel,
    onToggleLeftSidebar: actions.onToggleSidebar,
    onToggleRightPanel: actions.toggleRightPanel,
  });

  useEffect(() => {
    if (!publishDialog.open) {
      return;
    }
    if (
      !hasRuntimeReadyWorkspace
      || !activePublishWorkspaceId
      || publishDialog.workspaceId !== activePublishWorkspaceId
    ) {
      actions.closePublishDialog();
    }
  }, [
    actions,
    activePublishWorkspaceId,
    hasRuntimeReadyWorkspace,
    publishDialog.open,
    publishDialog.workspaceId,
  ]);

  return (
    <DebugProfiler id="workspace-shell">
      <WorkspaceShellActionsProvider value={shellActions}>
        <WorkspacePathProvider workspacePath={selectedWorkspace?.path ?? null}>
          <div
        className={`h-screen flex overflow-hidden ${chromeClasses.root}`}
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
                downloadProgress={downloadProgress}
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
          className={`flex min-w-0 flex-1 flex-col overflow-hidden ${chromeClasses.contentShell}`}
        >
          <div
            className={chromeClasses.header}
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
                  downloadProgress={downloadProgress}
                  onDownloadUpdate={downloadUpdate}
                  onOpenRestartPrompt={openRestartPrompt}
                />
              </div>
            )}
            {hasWorkspaceShell && (
              <GlobalHeader
                existingPr={existingPr}
                selectedWorkspace={selectedWorkspace}
                rightPanelOpen={rightPanelOpen}
                disableGitActions={!hasRuntimeReadyWorkspace}
                runDisabled={!runCommand.canRun}
                runLoading={runCommand.isLaunching}
                runLabel={runCommand.runLabel}
                runTitle={runCommand.runTitle}
                onRun={runCommand.onRun}
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
                      workspaceId={selectedWorkspaceId}
                      isWorkspaceReady={hasRuntimeReadyWorkspace}
                      shouldKeepContentVisible={shouldKeepRuntimePanelsVisible}
                      isCloudWorkspaceSelected={isCloudWorkspaceSelected}
                      state={rightPanelState}
                      repoSettingsHref={repoSettingsHref ?? buildSettingsHref({
                        section: "repo",
                        repo: null,
                      })}
                      onStateChange={layout.setRightPanelState}
                      terminalActivationRequestToken={terminalActivationRequestToken}
                    />
                  </div>
                </div>

                <WorkspaceCommandPalette
                  open={commandPaletteOpen}
                  onClose={actions.onCommandPaletteClose}
                  hasWorkspaceShell={hasWorkspaceShell}
                  selectedWorkspaceId={selectedWorkspaceId}
                  hasRuntimeReadyWorkspace={hasRuntimeReadyWorkspace}
                  runtimeBlockedReason={runtimeBlockedReason}
                  repoSettingsHref={repoSettingsHref}
                  canOpenRepositorySettings={canOpenRepositorySettings}
                  repositorySettingsDisabledReason={repositorySettingsDisabledReason}
                  runCommand={runCommand}
                  openTerminalPanel={actions.openTerminalPanel}
                  onToggleLeftSidebar={actions.onToggleSidebar}
                  onToggleRightPanel={actions.toggleRightPanel}
                />

                {hasRuntimeReadyWorkspace && (
                  <>
                    <PublishDialog
                      open={publishDialog.open}
                      workspaceId={publishDialog.workspaceId}
                      initialIntent={publishDialog.initialIntent}
                      runtimeBlockedReason={runtimeBlockedReason}
                      repoDefaultBranch={publishRepoDefaultBranch}
                      onClose={actions.closePublishDialog}
                      onViewPr={actions.handlePublishDialogViewPr}
                    />
                    <ConnectedReviewSetupDialog />
                    <ConnectedReviewCritiqueDialog />
                  </>
                )}
              </>
            ) : (
              <HomeNextScreen />
            )}
          </div>
        </div>
          </div>
        </WorkspacePathProvider>
      </WorkspaceShellActionsProvider>
    </DebugProfiler>
  );
}
