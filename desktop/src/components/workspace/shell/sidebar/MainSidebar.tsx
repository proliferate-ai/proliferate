import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SupportDialog } from "@/components/support/SupportDialog";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarPrimaryNavigation } from "./SidebarPrimaryNavigation";
import { SidebarRepositoriesHeader } from "./SidebarRepositoriesHeader";
import { SidebarWorkspaceContent } from "./SidebarWorkspaceContent";
import { WorkspaceCleanupAttentionSection } from "./WorkspaceCleanupAttentionSection";
import { CoworkThreadsSection } from "@/components/workspace/cowork/sidebar/CoworkThreadsSection";
import {
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import {
  isDefaultSidebarWorkspaceTypes,
} from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { buildConfiguredCloudRepoKeys } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { APP_ROUTES } from "@/config/app-routes";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useSidebarSupportContext } from "@/hooks/support/derived/use-sidebar-support-context";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "@/hooks/workspaces/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useSidebarRepoGroupState } from "@/hooks/workspaces/facade/use-sidebar-repo-group-state";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useSessionActivityReconciler } from "@/hooks/sessions/lifecycle/use-session-activity-reconciler";
import {
  buildCloudRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import { startMeasurementOperation } from "@/lib/infra/measurement/debug-measurement";
import { subscribeSupportDialogRequest } from "@/lib/infra/support/support-dialog-request";

export const MainSidebar = memo(function MainSidebar() {
  useDebugRenderCount("workspace-sidebar");
  useSessionActivityReconciler();
  const actions = useWorkspaceSidebarActions();
  const supportContext = useSidebarSupportContext();
  const {
    cloudActive,
    cloudUnavailable,
  } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: cloudRepoConfigs,
    isPending: isCloudRepoConfigsPending,
  } = useCloudRepoConfigs(cloudActive);
  const [supportOpen, setSupportOpen] = useState(false);
  useEffect(() => subscribeSupportDialogRequest(() => setSupportOpen(true)), []);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const {
    showArchived,
    setShowArchived,
    workspaceTypes,
    toggleSidebarWorkspaceType,
  } = useWorkspaceUiStore(useShallow((state) => ({
    showArchived: state.showArchived,
    setShowArchived: state.setShowArchived,
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
  } = useWorkspaceSidebarState({ showArchived });
  const navigate = useNavigate();
  const location = useLocation();

  const isOnPlugins = location.pathname === APP_ROUTES.plugins;
  const isOnAutomations = location.pathname.startsWith(APP_ROUTES.automations);
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
    () => buildConfiguredCloudRepoKeys(cloudRepoConfigs?.configs),
    [cloudRepoConfigs?.configs],
  );
  const cloudRepoConfigsInitialLoading = cloudActive
    && isCloudRepoConfigsPending
    && !cloudRepoConfigs;

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

  const handleOpenRepoSettings = useCallback((sourceRoot: string) => {
    navigate(`/settings?section=repo&repo=${encodeURIComponent(sourceRoot)}`);
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
  const filtersActive = showArchived || !isDefaultSidebarWorkspaceTypes(workspaceTypes);

  return (
    <DebugProfiler id="workspace-sidebar">
      <ProductSidebarFrame footer={(
        <DebugProfiler id="workspace-sidebar-footer">
          <SidebarFooter />
        </DebugProfiler>
      )}>
      {supportOpen && (
        <SupportDialog
          onClose={() => setSupportOpen(false)}
          context={supportContext}
        />
      )}
      <ProductSidebarBody>
        <DebugProfiler id="workspace-sidebar-primary-nav">
          <SidebarPrimaryNavigation
            homeActive={isOnHome && !selectedWorkspaceId && !pendingWorkspaceEntry}
            pluginsActive={isOnPlugins}
            automationsActive={isOnAutomations}
            supportActive={supportOpen}
            onGoHome={actions.handleGoHome}
            onGoPlugins={actions.handleGoPlugins}
            onGoAutomations={actions.handleGoAutomations}
            onOpenSupport={() => setSupportOpen(true)}
          />
        </DebugProfiler>

        <ProductSidebarScrollableContent>
            <CoworkThreadsSection />
            <WorkspaceCleanupAttentionSection
              workspaces={cleanupAttentionWorkspaces}
              onRetryCleanup={actions.handleRetryWorkspaceCleanup}
            />

            <SidebarRepositoriesHeader
              hasRepoGroups={allRepoKeys.length > 0}
              allRepoGroupsCollapsed={allRepoGroupsCollapsed}
              filtersActive={filtersActive}
              showArchived={showArchived}
              workspaceTypes={workspaceTypes}
              onToggleAllRepoGroups={handleToggleAllRepoGroups}
              onToggleShowArchived={() => setShowArchived(!showArchived)}
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
                onArchiveWorkspace={archiveWorkspace}
                onUnarchiveWorkspace={unarchiveWorkspace}
                onRenameWorkspace={handleRenameWorkspace}
                onRemoveRepo={handleRemoveRepo}
                onOpenRepoSettings={handleOpenRepoSettings}
              />
            </DebugProfiler>
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
      </ProductSidebarFrame>
    </DebugProfiler>
  );
});
