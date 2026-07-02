import { memo, useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { SidebarAccountFooter } from "@/components/app/sidebar/SidebarAccountFooter";
import { SidebarPrimaryNavigation } from "./SidebarPrimaryNavigation";
import { SidebarRepositoriesHeader } from "./SidebarRepositoriesHeader";
import { SidebarWorkspaceContent } from "./SidebarWorkspaceContent";
import { WorkspaceCleanupAttentionSection } from "./WorkspaceCleanupAttentionSection";
import { CoworkThreadsSection } from "@/components/workspace/cowork/sidebar/CoworkThreadsSection";
import {
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
} from "@proliferate/product-ui/sidebar/ProductSidebarLayout";
import {
  isDefaultSidebarWorkspaceTypes,
} from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { buildConfiguredCloudRepoKeys } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { APP_ROUTES } from "@/config/app-routes";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { useSidebarShortcutTargets } from "@/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "@/hooks/workspaces/workflows/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useSidebarRepoGroupState } from "@/hooks/workspaces/facade/use-sidebar-repo-group-state";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useSessionActivityReconciler } from "@/hooks/sessions/lifecycle/use-session-activity-reconciler";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { buildShortcutRangeLabelById } from "@/lib/domain/shortcuts/presentation";
import { startMeasurementOperation } from "@/lib/infra/measurement/debug-measurement";
import { useShortcutRevealVisible } from "@/providers/ShortcutRevealProvider";
import { useToastStore } from "@/stores/toast/toast-store";

interface ArchiveConfirmationState {
  workspaceId: string;
  cloudWorkspaceId: string | null;
  name: string;
}

export const MainSidebar = memo(function MainSidebar() {
  useDebugRenderCount("workspace-sidebar");
  useSessionActivityReconciler();
  const actions = useWorkspaceSidebarActions();
  const handleOpenSupport = useOpenSupportReportWindow({ source: "sidebar" });
  const shortcutRevealVisible = useShortcutRevealVisible();
  const sidebarShortcutTargetIds = useSidebarShortcutTargets();
  const {
    cloudActive,
    cloudUnavailable,
  } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: repoConfigs,
    isPending: isRepoConfigsPending,
  } = useRepositories(cloudActive);
  const showToast = useToastStore((state) => state.show);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const {
    workspaceTypes,
    toggleSidebarWorkspaceType,
  } = useWorkspaceUiStore(useShallow((state) => ({
    workspaceTypes: state.workspaceTypes,
    toggleSidebarWorkspaceType: state.toggleSidebarWorkspaceType,
  })));
  const {
    groups,
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
  const [archiveConfirmation, setArchiveConfirmation] =
    useState<ArchiveConfirmationState | null>(null);
  const {
    archiveCloudWorkspace: archiveCloudWorkspaceRequest,
    restoreCloudWorkspace: restoreCloudWorkspaceRequest,
  } = useCloudWorkspaceActions();

  const isOnWorkflows = location.pathname.startsWith(APP_ROUTES.workflows);
  const isOnWorkspaces = location.pathname === APP_ROUTES.workspaces;
  const isOnHome = location.pathname === APP_ROUTES.home;
  const archiveWorkspace = useWorkspaceUiStore((s) => s.archiveWorkspace);
  const hideRepoRoot = useWorkspaceUiStore((s) => s.hideRepoRoot);
  const unarchiveWorkspace = useWorkspaceUiStore((s) => s.unarchiveWorkspace);
  const unarchiveWorkspaces = useWorkspaceUiStore((s) => s.unarchiveWorkspaces);
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
    allRepoKeys,
    allRepoGroupsCollapsed,
    collapsedRepoGroupKeys,
    repoGroupsShownMoreKeys,
    handleToggleRepoShowMore,
    handleToggleRepoCollapsed,
    handleToggleAllRepoGroups,
    clearRepoGroupShowMore,
  } = useSidebarRepoGroupState({
    groups,
    selectedLogicalWorkspaceId,
  });

  const handleRemoveRepo = useCallback((sourceRoot: string) => {
    const group = groups.find((g) => g.sourceRoot === sourceRoot);
    if (group) {
      unarchiveWorkspaces(group.allLogicalWorkspaceIds);
      if (group.repoRootId) {
        hideRepoRoot(group.repoRootId);
      }
    }
    clearRepoGroupShowMore(sourceRoot);
  }, [clearRepoGroupShowMore, groups, hideRepoRoot, unarchiveWorkspaces]);

  const resolveArchiveTargetForSidebarItem = useCallback((
    workspaceId: string,
  ): ArchiveConfirmationState => {
    for (const group of groups) {
      const item = group.items.find((candidate) => candidate.id === workspaceId);
      if (item) {
        return {
          workspaceId,
          cloudWorkspaceId: item.cloudWorkspaceId,
          name: item.name,
        };
      }
    }
    return {
      workspaceId,
      cloudWorkspaceId: null,
      name: "this workspace",
    };
  }, [groups]);

  const handleArchiveWorkspace = useCallback((workspaceId: string) => {
    setArchiveConfirmation(resolveArchiveTargetForSidebarItem(workspaceId));
  }, [resolveArchiveTargetForSidebarItem]);

  const confirmArchiveWorkspace = useCallback(() => {
    const target = archiveConfirmation;
    if (!target) {
      return;
    }
    setArchiveConfirmation(null);
    const shouldLeaveWorkspace = selectedLogicalWorkspaceId === target.workspaceId
      || selectedWorkspaceId === target.workspaceId
      || (
        target.cloudWorkspaceId
        ? selectedWorkspaceId === cloudWorkspaceSyntheticId(target.cloudWorkspaceId)
        : false
      );
    const cloudWorkspaceId = target.cloudWorkspaceId;
    if (!cloudWorkspaceId) {
      archiveWorkspace(target.workspaceId);
      if (shouldLeaveWorkspace) {
        actions.handleGoHome();
      }
      return;
    }
    if (shouldLeaveWorkspace) {
      actions.handleGoHome();
    }
    void archiveCloudWorkspaceRequest(cloudWorkspaceId)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to archive workspace.";
        showToast(message);
      });
  }, [
    actions,
    archiveConfirmation,
    archiveWorkspace,
    archiveCloudWorkspaceRequest,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showToast,
  ]);

  const handleUnarchiveWorkspace = useCallback((workspaceId: string) => {
    const cloudWorkspaceId = resolveArchiveTargetForSidebarItem(workspaceId).cloudWorkspaceId;
    if (!cloudWorkspaceId) {
      unarchiveWorkspace(workspaceId);
      return;
    }
    void restoreCloudWorkspaceRequest(cloudWorkspaceId).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to restore workspace.";
      showToast(message);
    });
  }, [
    resolveArchiveTargetForSidebarItem,
    restoreCloudWorkspaceRequest,
    showToast,
    unarchiveWorkspace,
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

  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.startBlocked;
  const cloudWorkspaceTooltip = cloudUnavailable
    ? CAPABILITY_COPY.cloudDisabledTooltip
    : cloudWorkspaceBlocked
      ? `${titleForStartBlockReason(billingPlan?.startBlockReason)}.`
      : CAPABILITY_COPY.cloudSignInTooltip;
  const filtersActive = !isDefaultSidebarWorkspaceTypes(workspaceTypes);
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
      <ProductSidebarFrame footer={(
        <DebugProfiler id="workspace-sidebar-footer">
          <SidebarAccountFooter />
        </DebugProfiler>
      )}>
      <ProductSidebarBody>
        <DebugProfiler id="workspace-sidebar-primary-nav">
          <SidebarPrimaryNavigation
            homeActive={isOnHome && !selectedWorkspaceId && !pendingWorkspaceEntry}
            workspacesActive={isOnWorkspaces}
            workflowsActive={isOnWorkflows}
            supportActive={false}
            onGoHome={actions.handleGoHome}
            onGoWorkspaces={actions.handleGoWorkspaces}
            onGoWorkflows={actions.handleGoWorkflows}
            onOpenSupport={handleOpenSupport}
            shortcutRevealVisible={shortcutRevealVisible}
            shortcutLabels={primaryNavShortcutLabels}
          />
        </DebugProfiler>

        <ProductSidebarScrollableContent>
          <WorkspaceCleanupAttentionSection
            workspaces={cleanupAttentionWorkspaces}
            onRetryCleanup={actions.handleRetryWorkspaceCleanup}
          />

          <SidebarRepositoriesHeader
            hasRepoGroups={allRepoKeys.length > 0}
            allRepoGroupsCollapsed={allRepoGroupsCollapsed}
            filtersActive={filtersActive}
            workspaceTypes={workspaceTypes}
            onToggleAllRepoGroups={handleToggleAllRepoGroups}
            onToggleWorkspaceType={toggleSidebarWorkspaceType}
            onAddRepo={actions.handleAddRepo}
          />

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
              cloudWorkspaceEnabled={cloudActive && !cloudWorkspaceBlocked}
              cloudWorkspaceTooltip={cloudWorkspaceTooltip}
              onCreateWorktreeWorkspace={actions.handleCreateWorktreeWorkspace}
              onCreateLocalWorkspace={actions.handleCreateLocalWorkspace}
              onCreateCloudWorkspace={actions.handleCreateCloudWorkspace}
              onOpenCloudRepoSettings={handleOpenCloudRepoSettings}
              onSelectWorkspace={actions.handleSelectWorkspace}
              onIndicatorAction={actions.handleSidebarIndicatorAction}
              onMarkWorkspaceDone={actions.handleMarkWorkspaceDone}
              onWorkspaceHover={handleWorkspaceHover}
              shortcutRevealVisible={shortcutRevealVisible}
              shortcutLabelByWorkspaceId={sidebarShortcutLabelById}
              onArchiveWorkspace={handleArchiveWorkspace}
              onUnarchiveWorkspace={handleUnarchiveWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
              onRemoveRepo={handleRemoveRepo}
              onOpenRepoSettings={handleOpenRepoSettings}
            />
          </DebugProfiler>
          <CoworkThreadsSection />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
      <ConfirmationDialog
        open={archiveConfirmation !== null}
        title="Archive workspace?"
        description={`Move ${archiveConfirmation?.name ?? "this workspace"} out of the main sidebar. It will remain available in Settings -> Archived chats, and safe worktree cleanup may run in the background.`}
        confirmLabel="Archive"
        onClose={() => setArchiveConfirmation(null)}
        onConfirm={confirmArchiveWorkspace}
      />
      </ProductSidebarFrame>
    </DebugProfiler>
  );
});
