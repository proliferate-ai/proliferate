import { memo, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useRemoveCloudRepoEnvironment, useRepositories } from "@proliferate/cloud-sdk-react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { SidebarAccountFooter } from "#product/components/app/sidebar/SidebarAccountFooter";
import { ReleaseNoticeCard } from "#product/components/workspace/shell/sidebar/ReleaseNoticeCard";
import { SidebarPinnedNavigation } from "#product/components/workspace/shell/sidebar/SidebarPrimaryNavigation";
import { SidebarScrollingNavigationSection } from "#product/components/workspace/shell/sidebar/SidebarScrollingNavigationSection";
import { SidebarPinnedSection } from "#product/components/workspace/shell/sidebar/SidebarPinnedSection";
import { SidebarRepositoriesHeader } from "#product/components/workspace/shell/sidebar/SidebarRepositoriesHeader";
import { SidebarWorkspaceContent } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceContent";
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
import { ARCHIVE_TOAST_COPY } from "#product/copy/workspaces/archive-toast-copy";
import { APP_ROUTES } from "#product/config/app-routes";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useSidebarRepoAvailabilityActions } from "#product/hooks/workspaces/workflows/use-sidebar-repo-availability-actions";
import { useWorkspaceAvailabilityIntentStore } from "#product/stores/cloud/workspace-availability-intent-store";
import type { WorkspaceAvailabilityCommandKind } from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { workspaceAvailabilityIntentForCommand } from "#product/lib/domain/workspaces/cloud/workspace-availability-intent-mapping";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import {
  filterOptimisticallyArchivedSidebarGroups,
  isSidebarWorkspaceOptimisticallyVisible,
} from "#product/lib/domain/workspaces/sidebar/sidebar-visible-items";
import { useCloudBilling } from "#product/hooks/cloud/facade/use-cloud-billing";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useSidebarShortcutTargets } from "#product/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "#product/hooks/workspaces/workflows/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useSidebarRepoGroupState } from "#product/hooks/workspaces/facade/use-sidebar-repo-group-state";
import { useWorkspaceSidebarState } from "#product/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useSessionActivityReconciler } from "#product/hooks/sessions/lifecycle/use-session-activity-reconciler";
import { useWorkspaceArchiveActionsContext } from "#product/providers/WorkspaceArchiveActionsProvider";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { UnarchiveScenarioDialog } from "#product/components/settings/panes/archived/UnarchiveScenarioDialog";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "#product/lib/domain/settings/navigation";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { buildShortcutRangeLabelById } from "#product/lib/domain/shortcuts/presentation";
import { startMeasurementOperation } from "#product/lib/infra/measurement/measurement-port";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useReleaseNotice } from "#product/hooks/updates/facade/use-release-notice";

// Platform cannot change at runtime, so the label is resolved once rather
// than on every render of the sidebar.
const NEW_CHAT_SHORTCUT_LABEL = getShortcutDisplayLabel(SHORTCUTS.newDefault);

interface SidebarArchiveTarget {
  /**
   * The sidebar item's LOGICAL id (`remote:github:org:repo:branch`). It is a
   * UI-space key only: selection comparisons against
   * `selectedLogicalWorkspaceId` live here, and nothing else does.
   */
  logicalWorkspaceId: string;
  /**
   * The runtime workspace UUID. This — never the logical id — is what the
   * runtime archive/unarchive verbs address, what the optimistic-hide set is
   * keyed by, and what the pending reconciler polls (`lifecycle=all` returns
   * runtime records). Null when the row has no local materialization (a
   * cloud-only row, or a pending projection not yet on the runtime).
   */
  runtimeWorkspaceId: string | null;
  cloudWorkspaceId: string | null;
  name: string;
}

export const MainSidebar = memo(function MainSidebar({
  showRightBorder = true,
  glassBackground = false,
}: {
  showRightBorder?: boolean;
  glassBackground?: boolean;
}) {
  useDebugRenderCount("workspace-sidebar");
  useSessionActivityReconciler();
  const { notice, dismissNotice, openChangelog } = useReleaseNotice();
  const actions = useWorkspaceSidebarActions();
  const shortcutRevealVisible = useShortcutRevealVisible();
  const { digitTargetIds } = useSidebarShortcutTargets();
  const { cloudActive, cloudUnavailable, authStatus: cloudAuthStatus, cloudComputeEnabled } =
    useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: repoConfigs,
    isPending: isRepoConfigsPending,
  } = useRepositories(cloudActive);
  const showToast = useToastStore((state) => state.show);
  const removeCloudRepoEnvironment = useRemoveCloudRepoEnvironment();
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
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
    groups: sidebarGroups,
    pinnedItems: sidebarPinnedItems,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    emptyState,
    isLoading,
  } = useWorkspaceSidebarState({
    showArchived: false,
    repoConfigs: repoConfigs?.repositories ?? [],
    cloudComputeEnabled,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const {
    archive: archiveWorkspaceLocal,
    unarchive: unarchiveWorkspaceLocal,
    optimisticallyArchivedIds,
    scenario: unarchiveScenario,
    dismissScenario: dismissUnarchiveScenario,
  } = useWorkspaceArchiveActionsContext();

  // The optimistic-hide set: a row with an archive POST in flight (or
  // genuinely unknown, mid-timeout) is filtered out here rather than in
  // `useWorkspaceSidebarState` — the lifecycle-filtered queries stay the
  // single source of truth for which workspaces exist; this is purely a
  // client-local "don't paint this row while its outcome is unsettled".
  // The set is keyed by the id that was handed to `archive()` — the RUNTIME
  // workspace id, which is also what the pending reconciler settles against.
  // A row is matched on either id space so the hide holds whichever key the
  // caller used (a cloud row is archived by its cloud id, a local row by its
  // runtime UUID).
  const groups = useMemo(() => filterOptimisticallyArchivedSidebarGroups(
    sidebarGroups,
    optimisticallyArchivedIds,
  ), [optimisticallyArchivedIds, sidebarGroups]);
  // The Pinned section is a flattened view of the same rows, so the in-flight
  // hide must reach it too or the archived row lingers there.
  const pinnedItems = useMemo(() => {
    if (optimisticallyArchivedIds.size === 0) {
      return sidebarPinnedItems;
    }
    return sidebarPinnedItems.filter((item) =>
      isSidebarWorkspaceOptimisticallyVisible(item, optimisticallyArchivedIds));
  }, [optimisticallyArchivedIds, sidebarPinnedItems]);

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

  // Callers reach this with whichever id their surface holds: the row actions
  // and ⌘⇧A pass the logical item id, while a re-entrant path (the 409
  // scenario dialog, Undo) carries the runtime id the verb was posted with.
  // Match on both so the resolved target is complete either way.
  const resolveArchiveTargetForSidebarItem = useCallback((
    workspaceId: string,
  ): SidebarArchiveTarget => {
    for (const group of groups) {
      const item = group.items.find((candidate) =>
        candidate.id === workspaceId || candidate.localWorkspaceId === workspaceId);
      if (item) {
        return {
          logicalWorkspaceId: item.id,
          runtimeWorkspaceId: item.localWorkspaceId,
          cloudWorkspaceId: item.cloudWorkspaceId,
          name: item.name,
        };
      }
    }
    return {
      logicalWorkspaceId: workspaceId,
      runtimeWorkspaceId: null,
      cloudWorkspaceId: null,
      name: "this workspace",
    };
  }, [groups]);

  // Archive is instant — no confirmation dialog. Selection handoff happens
  // BEFORE the archive POST resolves: waiting for the response would leave
  // the user staring at a workspace that is being torn down.
  const handleArchiveWorkspace = useCallback((workspaceId: string) => {
    const target = resolveArchiveTargetForSidebarItem(workspaceId);
    const { cloudWorkspaceId, runtimeWorkspaceId } = target;
    // Nothing on the runtime to archive: a row projected before its workspace
    // materialized. Refuse rather than post the logical id, which the runtime
    // can only answer with 404 WORKSPACE_NOT_FOUND — and refuse BEFORE the
    // selection handoff, so a doomed request never also moves the user.
    if (!cloudWorkspaceId && !runtimeWorkspaceId) {
      showToast(ARCHIVE_TOAST_COPY.archiveFailedTitle(target.name));
      return;
    }
    // Each comparison stays in its own id space: `selectedLogicalWorkspaceId`
    // holds the logical id, `selectedWorkspaceId` the runtime workspace id
    // (or a cloud row's synthetic id).
    const shouldLeaveWorkspace = selectedLogicalWorkspaceId === target.logicalWorkspaceId
      || (runtimeWorkspaceId !== null && selectedWorkspaceId === runtimeWorkspaceId)
      || (
        cloudWorkspaceId
        ? selectedWorkspaceId === cloudWorkspaceSyntheticId(cloudWorkspaceId)
        : false
      );
    if (shouldLeaveWorkspace) {
      actions.handleGoHome();
    }
    if (cloudWorkspaceId) {
      // The cloud workspace stack is deleted; a stale cloud row has no
      // archive request left to send.
      showToast("Cloud workspaces are no longer available.");
      return;
    }
    if (runtimeWorkspaceId) {
      archiveWorkspaceLocal(runtimeWorkspaceId, target.name, shouldLeaveWorkspace);
    }
  }, [
    actions,
    archiveWorkspaceLocal,
    resolveArchiveTargetForSidebarItem,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showToast,
  ]);

  const handleUnarchiveWorkspace = useCallback((workspaceId: string) => {
    const target = resolveArchiveTargetForSidebarItem(workspaceId);
    const { cloudWorkspaceId, runtimeWorkspaceId } = target;
    if (cloudWorkspaceId) {
      // The cloud workspace stack is deleted; a stale cloud row has no
      // restore request left to send.
      showToast("Cloud workspaces are no longer available.");
      return;
    }
    // Same id-space rule as archive: /unarchive addresses the runtime id.
    if (!runtimeWorkspaceId) {
      showToast(ARCHIVE_TOAST_COPY.unarchiveFailedTitle(target.name));
      return;
    }
    unarchiveWorkspaceLocal(runtimeWorkspaceId, target.name);
  }, [
    resolveArchiveTargetForSidebarItem,
    showToast,
    unarchiveWorkspaceLocal,
  ]);

  // ⌘⇧A, scoped to whichever workspace the sidebar currently has selected.
  // Returning `false` when nothing is selected declines the shortcut and
  // leaves browser behavior intact, per the handler contract.
  useShortcutHandler("workspace.archive", () => {
    const targetId = selectedLogicalWorkspaceId ?? selectedWorkspaceId;
    if (!targetId) {
      return false;
    }
    handleArchiveWorkspace(targetId);
  });

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
  // A signed-in user on a compute-unconfigured deployment sees the operator
  // explanation, not a "sign in" tooltip they can't act on (PR2-GATING-01).
  const cloudComputeUnconfiguredForSignedInUser =
    cloudAuthStatus === "authenticated" && !cloudComputeEnabled;
  const cloudWorkspaceEnabled = !cloudWorkspaceBlocked && cloudComputeEnabled;
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
  const sidebarShortcutLabelById = useMemo(
    () => buildShortcutRangeLabelById(digitTargetIds, SHORTCUTS.workspaceByIndex),
    [digitTargetIds],
  );

  return (
    <DebugProfiler id="workspace-sidebar">
      <ProductSidebarFrame showRightBorder={showRightBorder} glassBackground={glassBackground} footer={(
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
              newChatShortcutLabel={NEW_CHAT_SHORTCUT_LABEL}
            />
          </DebugProfiler>

        <ProductSidebarScrollableContent>
          <SidebarScrollingNavigationSection
            onGoWorkspaces={actions.handleGoWorkspaces}
            onGoWorkflows={actions.handleGoWorkflows}
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
                cloudWorkspaceEnabled={cloudWorkspaceEnabled}
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
              />
            </DebugProfiler>
          )}
          {isDesktopHost ? <CoworkThreadsSection /> : null}
        </ProductSidebarScrollableContent>
        </ProductSidebarBody>
        <UnarchiveScenarioDialog
          state={unarchiveScenario}
          onCancel={dismissUnarchiveScenario}
          onConfirm={(workspaceId, answer) => {
            const name = resolveArchiveTargetForSidebarItem(workspaceId).name;
            unarchiveWorkspaceLocal(workspaceId, name, answer);
          }}
        />
      </ProductSidebarFrame>
    </DebugProfiler>
  );
});
