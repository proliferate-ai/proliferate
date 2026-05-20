import { HomeNextScreen } from "@/components/home/screen/HomeNextScreen";
import {
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { PublishDialog } from "@/components/workspace/git/PublishDialog";
import { ConnectedReviewCritiqueDialog } from "@/components/workspace/reviews/ConnectedReviewCritiqueDialog";
import { ConnectedReviewSetupDialog } from "@/components/workspace/reviews/ConnectedReviewSetupDialog";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { GlobalHeader } from "@/components/workspace/shell/topbar/GlobalHeader";
import { WorkspaceContentView } from "@/components/workspace/shell/screen/WorkspaceContentView";
import {
  WorkspaceHeaderTabsViewModelProvider,
} from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { WorkspaceShellActionsProvider } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { WorkspaceCommandPalette } from "@/components/workspace/shell/command-palette/WorkspaceCommandPalette";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { SplitPanel } from "@/components/ui/icons";
import { useMainScreenState } from "@/hooks/main/facade/use-main-screen-state";
import { useMainScreenShortcuts } from "@/hooks/main/lifecycle/use-main-screen-shortcuts";
import { useMainScreenActions } from "@/hooks/main/workflows/use-main-screen-actions";
import { useTransparentChromeEnabled } from "@/hooks/theme/derived/use-transparent-chrome";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useNativeOverlayOpen } from "@/hooks/ui/use-native-overlay-presence";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useRunWorkspaceCommand } from "@/hooks/workspaces/workflows/use-run-workspace-command";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceActivityAcknowledgement } from "@/hooks/workspaces/lifecycle/use-workspace-activity-acknowledgement";
import { resolveStandardWorkspaceChromeClasses } from "@/lib/domain/preferences/workspace-chrome";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import { resolvePendingWorkspacePath } from "@/lib/domain/workspaces/creation/pending-entry";

const CHAT_SHELL_RENDER_SURFACE: WorkspaceRenderSurface = { kind: "chat-shell" };

export function StandardWorkspaceShell() {
  useDebugRenderCount("workspace-shell");
  // Workspace activity is a shell-level read receipt: if the selected workspace
  // is visible, activity in any shell tab is considered consumed. Session error
  // acknowledgement intentionally stays in ChatView because errors are
  // transcript-scoped and need the chat surface for context.
  useWorkspaceActivityAcknowledgement();
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
    }),
    [sidebarOpen, transparentChromeEnabled],
  );
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
        <WorkspacePathProvider workspacePath={selectedWorkspace?.path ?? pendingWorkspacePath}>
          <WorkspaceHeaderTabsViewModelProvider
            enabled={hasWorkspaceShell && !hasLaunchIntentOnlyShell}
          >
            <div
              className={`h-screen flex overflow-hidden ${chromeClasses.root}`}
              data-workspace-shell
              data-workspace-ui-key={selectedLogicalWorkspaceId ?? selectedWorkspaceId ?? ""}
              data-pending-workspace={pendingWorkspaceEntry ? "true" : "false"}
              data-pending-workspace-attempt-id={pendingWorkspaceEntry?.attemptId ?? undefined}
              data-telemetry-block
            >
              <div
                id="main-sidebar"
                className="flex shrink-0 flex-col overflow-hidden bg-sidebar-background transition-[width] duration-150 ease-in-out"
                style={{ width: sidebarOpen ? sidebarWidth : 0 }}
              >
                <DebugProfiler id="workspace-sidebar-frame">
                  <div className="flex h-full min-h-0 flex-col">
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
                </DebugProfiler>
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
                className="flex min-w-0 flex-1 overflow-hidden bg-background"
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

                  <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
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
                            <WorkspaceContentView />
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
                            openTerminalPanel={actions.openTerminalPanel}
                            onToggleLeftSidebar={actions.onToggleSidebar}
                            onToggleRightPanel={actions.toggleRightPanel}
                          />
                        </DebugProfiler>

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

                {hasWorkspaceShell && !hasLaunchIntentOnlyShell && rightPanelOpen && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={onRightSeparatorDown}
                    className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -mr-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
                  />
                )}
                {hasWorkspaceShell && !hasLaunchIntentOnlyShell && (
                  <div
                    className="shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out"
                    style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
                  >
                    <DebugProfiler id="workspace-right-panel">
                      <div className="h-full" style={{ minWidth: 260 }}>
                        <RightPanel
                          workspaceId={selectedWorkspaceId}
                          workspaceUiKey={workspaceUiKey}
                          isWorkspaceReady={hasRuntimeReadyWorkspace}
                          isOpen={rightPanelOpen}
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
                          onTogglePanel={actions.toggleRightPanel}
                          onTerminalActivationRequestHandled={handleTerminalActivationRequestHandled}
                        />
                      </div>
                    </DebugProfiler>
                  </div>
                )}
              </div>
            </div>
          </WorkspaceHeaderTabsViewModelProvider>
        </WorkspacePathProvider>
      </WorkspaceShellActionsProvider>
    </DebugProfiler>
  );
}
