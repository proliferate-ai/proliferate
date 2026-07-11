import { HomeNextScreen } from "@/components/home/screen/HomeNextScreen";
import {
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { PublishDialog } from "@/components/workspace/git/PublishDialog";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { GlobalHeader } from "@/components/workspace/shell/topbar/GlobalHeader";
import { WorkspaceContentView } from "@/components/workspace/shell/screen/WorkspaceContentView";
import { WorkspaceShellShortcuts } from "@/components/workspace/shell/screen/WorkspaceShellShortcuts";
import { WorkspaceResizeSeparator } from "@/components/workspace/shell/screen/WorkspaceResizeSeparator";
import {
  WorkspaceHeaderTabsViewModelProvider,
} from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { WorkspaceShellActionsProvider } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { WorkspaceCommandPalette } from "@/components/workspace/shell/command-palette/WorkspaceCommandPalette";
import { WorkspaceShellRightRail } from "@/components/workspace/shell/screen/WorkspaceShellRightRail";
import { WorkspaceShellSidebar } from "@/components/workspace/shell/sidebar/WorkspaceShellSidebar";
import {
  WorkspaceSidebarHeaderControls,
} from "@/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { OfflineIndicator } from "@/components/app/OfflineIndicator";
import { useMainScreenState } from "@/hooks/main/facade/use-main-screen-state";
import { useMainScreenShortcuts } from "@/hooks/main/lifecycle/use-main-screen-shortcuts";
import { useMainScreenActions } from "@/hooks/main/workflows/use-main-screen-actions";
import { useTransparentChromeEnabled } from "@/hooks/theme/derived/use-transparent-chrome";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { useNativeOverlayOpen } from "@proliferate/ui/overlays/overlay-presence";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useRunWorkspaceCommand } from "@/hooks/workspaces/workflows/use-run-workspace-command";
import { useWorkspaceOpenInWebActions } from "@/hooks/workspaces/workflows/remote-access/use-workspace-open-in-web-actions";
import { useWorkspaceRemoteAccessActions } from "@/hooks/workspaces/workflows/remote-access/use-workspace-remote-access-actions";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceActivityAcknowledgement } from "@/hooks/workspaces/lifecycle/use-workspace-activity-acknowledgement";
import { resolveStandardWorkspaceChromeClasses } from "@/lib/domain/preferences/workspace-chrome";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  buildSettingsHref,
  resolveWorkspaceRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import { resolvePendingWorkspacePath } from "@/lib/domain/workspaces/creation/pending-entry";

const CHAT_SHELL_RENDER_SURFACE: WorkspaceRenderSurface = { kind: "chat-shell" };

export function StandardWorkspaceShell({ visible = true }: { visible?: boolean }) {
  useDebugRenderCount("workspace-shell");
  // Workspace activity is a shell-level read receipt: if the selected workspace
  // is visible, activity in any shell tab is considered consumed. Session error
  // acknowledgement intentionally stays in ChatView because errors are
  // transcript-scoped and need the chat surface for context.
  useWorkspaceActivityAcknowledgement({ enabled: visible });
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const pendingWorkspacePath = resolvePendingWorkspacePath(pendingWorkspaceEntry);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { layout, data } = useMainScreenState();
  const actions = useMainScreenActions({
    layout,
    existingPr: data.existingPr,
  });
  const {
    hasRuntimeReadyWorkspace,
    shouldKeepRuntimePanelsVisible,
    hasWorkspaceShell,
    hasLaunchIntentOnlyShell,
    isCloudWorkspaceSelected,
    workspaceUiKey,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedRepoRoot,
    selectedCloudWorkspace,
  } = data;
  const {
    sidebarOpen,
    sidebarWidth,
    rightPanelOpen,
    rightPanelState,
    rightPanelWidth,
    rightPanelFocusRequestToken,
    terminalActivationRequest,
    publishDialog,
    commandPaletteOpen,
    onLeftSeparatorDown,
    onRightSeparatorDown,
  } = layout;
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const chromeClasses = useMemo(
    () => resolveStandardWorkspaceChromeClasses({
      transparent: transparentChromeEnabled,
      sidebarOpen,
      showHeaderDivider: hasWorkspaceShell && !hasLaunchIntentOnlyShell,
      showContentTopBorder: hasWorkspaceShell && !hasLaunchIntentOnlyShell,
    }),
    [hasLaunchIntentOnlyShell, hasWorkspaceShell, sidebarOpen, transparentChromeEnabled],
  );
  const activePublishWorkspaceId = selectedWorkspaceId;
  const publishSourceRootPath = publishDialog.open
    ? selectedRepoRoot?.path?.trim() || selectedWorkspace?.path?.trim() || null
    : null;
  const publishRepoDefaultBranch = useRepoPreferencesStore((state) => (
    publishSourceRootPath
      ? state.repoConfigs[publishSourceRootPath]?.defaultBranch ?? null
      : null
  ));
  const {
    phase: updaterPhase,
    downloadProgress,
    restartWhenIdle,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  const runCommand = useRunWorkspaceCommand({
    selectedWorkspaceId,
    selectedWorkspace,
    selectedRepoRoot,
    selectedCloudWorkspace,
    isRuntimeReady: hasRuntimeReadyWorkspace,
    openTerminalPanel: actions.openTerminalPanel,
  });
  const workspaceWebActions = useWorkspaceOpenInWebActions();
  const workspaceRemoteAccessActions = useWorkspaceRemoteAccessActions();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const shellActions = useMemo(() => ({
    openTerminalPanel: actions.openTerminalPanel,
    openRightPanelTool: actions.onSetRightPanelTool,
    openPublishDialog: actions.openPublishDialog,
    openPullRequest: data.existingPr
      ? () => actions.handleViewPr(data.existingPr)
      : actions.handlePrOpen,
    workspaceWebActions,
    workspaceRemoteAccessActions,
  }), [
    actions.handlePrOpen,
    actions.handleViewPr,
    actions.onSetRightPanelTool,
    actions.openPublishDialog,
    actions.openTerminalPanel,
    data.existingPr,
    workspaceRemoteAccessActions,
    workspaceWebActions,
  ]);
  const repoSettingsHref = useMemo(() => resolveWorkspaceRepoSettingsHref({
    cloudRepoOwner: selectedCloudWorkspace?.repo?.owner,
    cloudRepoName: selectedCloudWorkspace?.repo?.name,
    repoRootPath: selectedRepoRoot?.path,
    workspacePath: selectedWorkspace?.path,
  }), [
    selectedCloudWorkspace?.repo?.name,
    selectedCloudWorkspace?.repo?.owner,
    selectedRepoRoot?.path,
    selectedWorkspace?.path,
  ]);
  const canOpenRepositorySettings = repoSettingsHref !== null;
  const repositorySettingsDisabledReason = canOpenRepositorySettings
    ? null
    : "Repository settings are unavailable.";
  const nativePortalOverlayOpen = useNativeOverlayOpen();
  const nativeWorkspaceOverlaysHidden = commandPaletteOpen
    || publishDialog.open
    || nativePortalOverlayOpen;
  const handleTerminalActivationRequestHandled = useCallback(
    (request: NonNullable<typeof terminalActivationRequest>) => {
      layout.setTerminalActivationRequest((current) =>
        current?.workspaceId === request.workspaceId
        && current.token === request.token
          ? null
          : current
      );
    },
    [layout.setTerminalActivationRequest],
  );

  useMainScreenShortcuts({
    enabled: visible,
    canOpenCommandPalette: hasWorkspaceShell,
    onOpenCommandPalette: actions.handleCommandPaletteOpen,
    onOpenWorkspaceInWeb: workspaceWebActions.openCurrentWorkspaceInWeb,
    onOpenTerminal: actions.openTerminalPanel,
    onSyncWorkspaceToWeb: workspaceRemoteAccessActions.syncToWeb,
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
        <WorkspacePathProvider workspacePath={selectedWorkspace?.path ?? pendingWorkspacePath}>
          <WorkspaceHeaderTabsViewModelProvider
            enabled={hasWorkspaceShell && !hasLaunchIntentOnlyShell}
          >
            {hasWorkspaceShell && !hasLaunchIntentOnlyShell ? (
              <WorkspaceShellShortcuts enabled={visible} />
            ) : null}
            <div
              className={`h-screen flex overflow-hidden ${chromeClasses.root}`}
              data-workspace-shell
              data-workspace-ui-key={selectedLogicalWorkspaceId ?? selectedWorkspaceId ?? ""}
              data-pending-workspace={pendingWorkspaceEntry ? "true" : "false"}
              data-pending-workspace-attempt-id={pendingWorkspaceEntry?.attemptId ?? undefined}
              data-telemetry-block
            >
              <WorkspaceShellSidebar
                open={sidebarOpen}
                width={sidebarWidth}
                updaterPhase={updaterPhase}
                downloadProgress={downloadProgress}
                restartWhenIdle={restartWhenIdle}
                onToggleSidebar={actions.onToggleSidebar}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
              {sidebarOpen && (
                <WorkspaceResizeSeparator
                  edge="left"
                  ariaControls="main-sidebar"
                  onMouseDown={onLeftSeparatorDown}
                />
              )}

              <div
                className="flex min-w-0 flex-1 overflow-hidden bg-sidebar"
              >
                <div
                  className={`flex min-w-0 flex-1 flex-col overflow-hidden ${chromeClasses.contentShell}`}
                >
                  <div
                    className={chromeClasses.header}
                    data-tauri-drag-region="true"
                  >
                    <DebugProfiler id="workspace-header-frame">
                      <>
                        {!sidebarOpen && (
                          <WorkspaceSidebarHeaderControls
                            className="pl-[82px] pr-2"
                            toggleTitle="Show sidebar"
                            phase={updaterPhase}
                            downloadProgress={downloadProgress}
                            restartWhenIdle={restartWhenIdle}
                            onToggleSidebar={actions.onToggleSidebar}
                            onDownloadUpdate={downloadUpdate}
                            onOpenRestartPrompt={openRestartPrompt}
                          />
                        )}
                        {hasWorkspaceShell && !hasLaunchIntentOnlyShell && (
                          <GlobalHeader
                            selectedWorkspace={selectedWorkspace}
                            workspacePath={selectedWorkspace?.path ?? pendingWorkspacePath}
                            rightPanelOpen={rightPanelOpen}
                            runDisabled={!runCommand.canRun}
                            runLoading={runCommand.isLaunching}
                            runLabel={runCommand.runLabel}
                            runTitle={runCommand.runTitle}
                            onRun={runCommand.onRun}
                            onTogglePanel={actions.toggleRightPanel}
                          />
                        )}
                      </>
                    </DebugProfiler>
                  </div>

                  <OfflineIndicator />
                  <div className="flex min-h-0 flex-1 overflow-hidden bg-sidebar-background">
                    {hasLaunchIntentOnlyShell ? (
                      <DebugProfiler id="workspace-content-frame">
                        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                          <ChatView shellRenderSurface={CHAT_SHELL_RENDER_SURFACE} />
                        </div>
                      </DebugProfiler>
                    ) : hasWorkspaceShell ? (
                      <>
                        <DebugProfiler id="workspace-content-frame">
                          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            <WorkspaceContentView visible={visible} />
                          </div>
                        </DebugProfiler>

                        <DebugProfiler id="workspace-command-palette">
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
                            workspaceWebActions={workspaceWebActions}
                            workspaceRemoteAccessActions={workspaceRemoteAccessActions}
                            openTerminalPanel={actions.openTerminalPanel}
                            onToggleLeftSidebar={actions.onToggleSidebar}
                            onToggleRightPanel={actions.toggleRightPanel}
                          />
                        </DebugProfiler>

                        {hasRuntimeReadyWorkspace && (
                          <PublishDialog
                            open={publishDialog.open}
                            workspaceId={publishDialog.workspaceId}
                            initialIntent={publishDialog.initialIntent}
                            runtimeBlockedReason={runtimeBlockedReason}
                            repoDefaultBranch={publishRepoDefaultBranch}
                            onClose={actions.closePublishDialog}
                            onIntentChange={actions.openPublishDialog}
                            onViewPr={actions.handlePublishDialogViewPr}
                          />
                        )}
                      </>
                    ) : (
                      <HomeNextScreen />
                    )}
                  </div>
                </div>

                <WorkspaceShellRightRail
                  visible={hasWorkspaceShell && !hasLaunchIntentOnlyShell}
                  open={rightPanelOpen}
                  width={rightPanelWidth}
                  onSeparatorMouseDown={onRightSeparatorDown}
                  workspaceId={selectedWorkspaceId}
                  workspaceUiKey={workspaceUiKey}
                  isWorkspaceReady={hasRuntimeReadyWorkspace}
                  shouldKeepContentVisible={shouldKeepRuntimePanelsVisible}
                  isCloudWorkspaceSelected={isCloudWorkspaceSelected}
                  state={rightPanelState}
                  repoSettingsHref={repoSettingsHref ?? buildSettingsHref({
                    section: "repo",
                    repo: null,
                  })}
                  onStateChange={layout.setRightPanelState}
                  terminalActivationRequest={terminalActivationRequest}
                  focusRequestToken={rightPanelFocusRequestToken}
                  nativeOverlaysHidden={nativeWorkspaceOverlaysHidden}
                  onOpenPanel={actions.openRightPanel}
                  onTogglePanel={actions.toggleRightPanel}
                  onTerminalActivationRequestHandled={handleTerminalActivationRequestHandled}
                />
              </div>
            </div>
          </WorkspaceHeaderTabsViewModelProvider>
        </WorkspacePathProvider>
      </WorkspaceShellActionsProvider>
    </DebugProfiler>
  );
}
