import { memo, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useRemoveCloudRepoEnvironment, useRepositories } from "@proliferate/cloud-sdk-react";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { SidebarAccountFooter } from "#product/components/app/sidebar/SidebarAccountFooter";
import { ReleaseNoticeCard } from "#product/components/workspace/shell/sidebar/ReleaseNoticeCard";
import {
  SidebarPinnedNavigation,
  SidebarScrollingNavigation,
} from "#product/components/workspace/shell/sidebar/SidebarPrimaryNavigation";
import { SidebarPinnedSection } from "#product/components/workspace/shell/sidebar/SidebarPinnedSection";
import { SidebarRepositoriesHeader } from "#product/components/workspace/shell/sidebar/SidebarRepositoriesHeader";
import { SidebarWorkspaceContent } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceContent";
import { WorkspaceCleanupAttentionSection } from "#product/components/workspace/shell/sidebar/WorkspaceCleanupAttentionSection";
import { CoworkThreadsSection } from "#product/components/workspace/cowork/sidebar/CoworkThreadsSection";
import {
  ProductSidebarBody,
  ProductSidebarBrandRow,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
} from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";
import { isDefaultSidebarWorkspaceTypes } from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { buildConfiguredCloudRepoKeys } from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { cloudRepositoryKey } from "#product/lib/domain/settings/repositories";
import { titleForStartBlockReason } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { CAPABILITY_COPY } from "#product/copy/capabilities/capability-copy";
import { APP_ROUTES } from "#product/config/app-routes";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useSidebarRepoAvailabilityActions } from "#product/hooks/workspaces/workflows/use-sidebar-repo-availability-actions";
import { useWorkspaceAvailabilityIntentStore } from "#product/stores/cloud/workspace-availability-intent-store";
import type { WorkspaceAvailabilityCommandKind } from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { workspaceAvailabilityIntentForCommand } from "#product/lib/domain/workspaces/cloud/workspace-availability-intent-mapping";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { useCloudBilling } from "#product/hooks/cloud/facade/use-cloud-billing";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useSidebarShortcutTargets } from "#product/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "#product/hooks/workspaces/workflows/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useWorkspaceSidebarArchiveActions } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-archive-actions";
import { useSidebarRepoGroupState } from "#product/hooks/workspaces/facade/use-sidebar-repo-group-state";
import { useWorkspaceSidebarState } from "#product/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useSessionActivityReconciler } from "#product/hooks/sessions/lifecycle/use-session-activity-reconciler";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "#product/lib/domain/settings/navigation";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { buildShortcutRangeLabelById } from "#product/lib/domain/shortcuts/presentation";
import { startMeasurementOperation } from "#product/lib/infra/measurement/measurement-port";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";
import { useReleaseNotice } from "#product/hooks/updates/facade/use-release-notice";
import { useRepositoryHeaderNewChat } from "#product/hooks/workspaces/ui/use-repository-header-new-chat";

export const MainSidebar = memo(function MainSidebar({ showRightBorder = true }: { showRightBorder?: boolean }) {
  useDebugRenderCount("workspace-sidebar");
  useSessionActivityReconciler();
  const { notice, dismissNotice, openChangelog } = useReleaseNotice();
  const actions = useWorkspaceSidebarActions();
  const { openBug: handleOpenSupport } = useOpenSupportReportWindow({ source: "sidebar" });
  const shortcutRevealVisible = useShortcutRevealVisible();
  const sidebarShortcutTargetIds = useSidebarShortcutTargets();
  const {
    cloudActive,
    cloudUnavailable,
    authStatus: cloudAuthStatus,
    cloudComputeEnabled,
  } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: repoConfigs,
    isPending: isRepoConfigsPending,
  } = useRepositories(cloudActive);
  const removeCloudRepoEnvironment = useRemoveCloudRepoEnvironment();
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const {
    sidebarOpen,
    workspaceTypes,
    toggleSidebarWorkspaceType,
    repositoriesCollapsed,
    setRepositoriesCollapsed,
  } = useWorkspaceUiStore(useShallow((state) => ({
    sidebarOpen: state.sidebarOpen,
    workspaceTypes: state.workspaceTypes,
    toggleSidebarWorkspaceType: state.toggleSidebarWorkspaceType,
    repositoriesCollapsed: state.repositoriesCollapsed,
    setRepositoriesCollapsed: state.setRepositoriesCollapsed,
  })));
  const {
    groups,
    pinnedItems,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    cleanupAttentionWorkspaces,
    emptyState,
    isLoading,
  } = useWorkspaceSidebarState({
    showArchived: false,
    repoConfigs: repoConfigs?.repositories ?? [],
  });
  const navigate = useNavigate();
  const location = useLocation();
  const {
    archiveConfirmation,
    closeArchiveConfirmation,
    confirmArchiveWorkspace,
    handleArchiveWorkspace,
    handleUnarchiveWorkspace,
  } = useWorkspaceSidebarArchiveActions({
    groups,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    onLeaveWorkspace: actions.handleGoHome,
  });

  const isOnWorkflows = location.pathname.startsWith(APP_ROUTES.workflows);
  const isOnWorkspaces = location.pathname === APP_ROUTES.workspaces;
  const isOnHome = location.pathname === APP_ROUTES.home;
  const hideRepoRoot = useWorkspaceUiStore((s) => s.hideRepoRoot);
  const pinWorkspace = useWorkspaceUiStore((s) => s.pinWorkspace);
  const unpinWorkspace = useWorkspaceUiStore((s) => s.unpinWorkspace);
  const { updateWorkspaceDisplayName } = useWorkspaceDisplayNameActions();
  const handleRenameWorkspace = useCallback(
    (workspaceId: string, displayName: string | null) =>
      updateWorkspaceDisplayName({ workspaceId, displayName }),
    [updateWorkspaceDisplayName],
  );
  const handleWorkspaceHover = useCallback(() => {
    startMeasurementOperation({
      kind: "hover_sample",
      sampleKey: "sidebar_workspace_row",
      surfaces: ["sidebar-workspace-row", "workspace-sidebar"],
      maxDurationMs: 750,
      cooldownMs: 2000,
    });
  }, []);
  const configuredCloudRepoKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(repoConfigs?.repositories),
    [repoConfigs?.repositories],
  );
  const cloudRepoConfigsInitialLoading = cloudActive
    && isRepoConfigsPending
    && !repoConfigs;

  const {
    collapsedRepoGroupKeys,
    repoGroupsShownMoreKeys,
    handleToggleRepoShowMore,
    handleToggleRepoCollapsed,
    clearRepoGroupShowMore,
  } = useSidebarRepoGroupState({
    groups,
    selectedLogicalWorkspaceId,
  });

  const handleRemoveRepo = useCallback(async (sourceRoot: string) => {
    const group = groups.find((g) => g.sourceRoot === sourceRoot);
    if (!group) {
      return;
    }
    if (group.cloudRepoTarget && configuredCloudRepoKeys.has(cloudRepositoryKey(
      group.cloudRepoTarget.gitOwner,
      group.cloudRepoTarget.gitRepoName,
    ))) {
      await removeCloudRepoEnvironment.mutateAsync(group.cloudRepoTarget);
    }
    if (group.repoRootId) {
      hideRepoRoot(group.repoRootId);
    }
    clearRepoGroupShowMore(sourceRoot);
  }, [
    clearRepoGroupShowMore,
    configuredCloudRepoKeys,
    groups,
    hideRepoRoot,
    removeCloudRepoEnvironment,
  ]);

  const handleOpenRepoSettings = useCallback((sourceRoot: string) => {
    navigate(buildSettingsHref({ section: "environments", repo: sourceRoot }));
  }, [navigate]);
  const handleOpenCloudRepoSettings = useCallback((target: {
    gitOwner: string;
    gitRepoName: string;
  }) => {
    navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
  }, [navigate]);

  const {
    isDesktopHost,
    managedCloudAvailable,
    handleSetUpCloud,
    handleAddToThisMac,
  } = useSidebarRepoAvailabilityActions();

  const beginWorkspaceAvailabilityIntent = useWorkspaceAvailabilityIntentStore(
    (state) => state.begin,
  );
  const handleWorkspaceAvailabilityCommand = useCallback((
    item: SidebarWorkspaceItemState,
    kind: WorkspaceAvailabilityCommandKind,
  ) => {
    const intent = workspaceAvailabilityIntentForCommand(kind, {
      localWorkspaceId: item.localWorkspaceId,
      cloudWorkspaceId: item.cloudWorkspaceIdForActions,
      linkedMaterializationId: item.linkedMaterializationId,
      repoOwner: item.repoOwner,
      repoName: item.repoName,
    });
    if (intent) {
      beginWorkspaceAvailabilityIntent(intent);
    }
  }, [beginWorkspaceAvailabilityIntent]);

  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.startBlocked;
  // Truthful cause for a blocked cloud-workspace action: a signed-in user on a
  // compute-unconfigured deployment sees the operator explanation, not a "sign
  // in" tooltip they can't act on (PR2-GATING-01 class).
  const cloudComputeUnconfiguredForSignedInUser =
    cloudAuthStatus === "authenticated" && !cloudComputeEnabled;
  const cloudWorkspaceTooltip = cloudUnavailable
    ? CAPABILITY_COPY.cloudDisabledTooltip
    : cloudWorkspaceBlocked
      ? `${titleForStartBlockReason(billingPlan?.startBlockReason)}.`
      : cloudComputeUnconfiguredForSignedInUser
        ? CAPABILITY_COPY.cloudNotConfiguredTooltip
        : CAPABILITY_COPY.cloudSignInTooltip;
  const handleToggleRepositoriesCollapsed = useCallback(() => {
    setRepositoriesCollapsed(!repositoriesCollapsed);
  }, [repositoriesCollapsed, setRepositoriesCollapsed]);
  const filtersActive = !isDefaultSidebarWorkspaceTypes(workspaceTypes);
  const handleStartRepositoryHeaderChat = useRepositoryHeaderNewChat(groups, actions);
  const sidebarShortcutLabelById = useMemo(
    () => buildShortcutRangeLabelById(sidebarShortcutTargetIds, SHORTCUTS.workspaceByIndex),
    [sidebarShortcutTargetIds],
  );
  const primaryNavShortcutLabels = useMemo(() => ({
    newChat: getShortcutDisplayLabel(SHORTCUTS.newDefault),
    support: getShortcutDisplayLabel(SHORTCUTS.openSupport),
  }), []);

  return (
    <DebugProfiler id="workspace-sidebar">
      <ProductSidebarFrame showRightBorder={showRightBorder} footer={(
          <DebugProfiler id="workspace-sidebar-footer">
            {sidebarOpen && notice ? (
              <ReleaseNoticeCard
                notice={notice}
                onDismiss={dismissNotice}
                onOpenChangelog={openChangelog}
              />
            ) : null}
            <SidebarAccountFooter />
          </DebugProfiler>
        )}>
        <ProductSidebarBody>
          <ProductSidebarBrandRow label="Proliferate" />
          {/* Only the brand row and New chat stay pinned. Everything below
              scrolls with the repository list. */}
          <DebugProfiler id="workspace-sidebar-primary-nav">
            <SidebarPinnedNavigation
              homeActive={isOnHome && !selectedWorkspaceId && !pendingWorkspaceEntry}
              onGoHome={actions.handleGoHome}
              shortcutRevealVisible={shortcutRevealVisible}
              newChatShortcutLabel={primaryNavShortcutLabels.newChat}
            />
          </DebugProfiler>

        <ProductSidebarScrollableContent>
          <SidebarScrollingNavigation
            workspacesActive={isOnWorkspaces}
            workflowsActive={isOnWorkflows}
            supportActive={false}
            onGoWorkspaces={actions.handleGoWorkspaces}
            onGoWorkflows={actions.handleGoWorkflows}
            onOpenSupport={handleOpenSupport}
            shortcutRevealVisible={shortcutRevealVisible}
            supportShortcutLabel={primaryNavShortcutLabels.support}
          />

          <WorkspaceCleanupAttentionSection
            workspaces={cleanupAttentionWorkspaces}
            onRetryCleanup={actions.handleRetryWorkspaceCleanup}
          />

          <SidebarPinnedSection
            items={pinnedItems}
            shortcutLabelByWorkspaceId={sidebarShortcutLabelById}
            shortcutRevealVisible={shortcutRevealVisible}
            onSelectWorkspace={actions.handleSelectWorkspace}
            onIndicatorAction={actions.handleSidebarIndicatorAction}
            onOpenPullRequest={actions.handleOpenPullRequest}
            onMarkWorkspaceDone={actions.handleMarkWorkspaceDone}
            onWorkspaceAvailabilityCommand={handleWorkspaceAvailabilityCommand}
            onWorkspaceHover={handleWorkspaceHover}
            onArchiveWorkspace={handleArchiveWorkspace}
            onUnarchiveWorkspace={handleUnarchiveWorkspace}
            onPinWorkspace={pinWorkspace}
            onUnpinWorkspace={unpinWorkspace}
            onRenameWorkspace={handleRenameWorkspace}
          />

          <SidebarRepositoriesHeader
            repositoriesCollapsed={repositoriesCollapsed}
            filtersActive={filtersActive}
            workspaceTypes={workspaceTypes}
            onToggleRepositoriesCollapsed={handleToggleRepositoriesCollapsed}
            onToggleWorkspaceType={toggleSidebarWorkspaceType}
            onNewChat={handleStartRepositoryHeaderChat}
            onAddRepo={actions.handleAddRepo}
          />

          {!repositoriesCollapsed && (
            <DebugProfiler id="workspace-sidebar-content">
              <SidebarWorkspaceContent
                emptyState={emptyState}
                isLoading={isLoading}
                groups={groups}
                collapsedRepoGroupKeys={collapsedRepoGroupKeys}
                repoGroupsShownMore={repoGroupsShownMoreKeys}
                onToggleRepoCollapsed={handleToggleRepoCollapsed}
                onToggleRepoShowMore={handleToggleRepoShowMore}
                configuredCloudRepoKeys={configuredCloudRepoKeys}
                cloudRepoConfigsInitialLoading={cloudRepoConfigsInitialLoading}
                cloudConnected={cloudActive}
                cloudWorkspaceEnabled={!cloudWorkspaceBlocked}
                cloudWorkspaceTooltip={cloudWorkspaceTooltip}
                onCreateWorktreeWorkspace={actions.handleCreateWorktreeWorkspace}
                onCreateLocalWorkspace={actions.handleCreateLocalWorkspace}
                onCreateCloudWorkspace={actions.handleCreateCloudWorkspace}
                onNewChatForRepository={actions.handleGoHomeForRepository}
                onSelectWorkspace={actions.handleSelectWorkspace}
                onIndicatorAction={actions.handleSidebarIndicatorAction}
                onOpenPullRequest={actions.handleOpenPullRequest}
                onMarkWorkspaceDone={actions.handleMarkWorkspaceDone}
                onWorkspaceAvailabilityCommand={handleWorkspaceAvailabilityCommand}
                onWorkspaceHover={handleWorkspaceHover}
                shortcutLabelByWorkspaceId={sidebarShortcutLabelById}
                shortcutRevealVisible={shortcutRevealVisible}
                onArchiveWorkspace={handleArchiveWorkspace}
                onUnarchiveWorkspace={handleUnarchiveWorkspace}
                onPinWorkspace={pinWorkspace}
                onUnpinWorkspace={unpinWorkspace}
                onRenameWorkspace={handleRenameWorkspace}
                onRemoveRepo={handleRemoveRepo}
                onOpenRepoSettings={handleOpenRepoSettings}
                isDesktopHost={isDesktopHost}
                managedCloudAvailable={managedCloudAvailable}
                onOpenCloudRepoSettingsForGroup={handleOpenCloudRepoSettings}
                onSetUpCloudForGroup={handleSetUpCloud}
                onAddToThisMac={handleAddToThisMac}
              />
            </DebugProfiler>
          )}
          {isDesktopHost ? <CoworkThreadsSection /> : null}
        </ProductSidebarScrollableContent>
        </ProductSidebarBody>
        <ConfirmationDialog
          open={archiveConfirmation !== null}
          title="Archive workspace?"
          description={`Move ${archiveConfirmation?.name ?? "this workspace"} out of the main sidebar. It will remain available in Settings -> Archived chats, and safe worktree cleanup may run in the background.`}
          confirmLabel="Archive"
          onClose={closeArchiveConfirmation}
          onConfirm={confirmArchiveWorkspace}
        />
      </ProductSidebarFrame>
    </DebugProfiler>
  );
});
