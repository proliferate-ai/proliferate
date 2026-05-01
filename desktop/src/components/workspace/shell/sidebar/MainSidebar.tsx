import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SupportDialog } from "@/components/support/SupportDialog";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarRowSurface } from "./SidebarRowSurface";
import { SidebarActionButton } from "./SidebarActionButton";
import { SidebarWorkspaceVariantIcon } from "./SidebarWorkspaceVariantIcon";
import {
  DEFAULT_REPO_GROUP_ITEM_LIMIT,
  SidebarWorkspaceContent,
} from "./SidebarWorkspaceContent";
import { WorkspaceCleanupAttentionSection } from "./WorkspaceCleanupAttentionSection";
import { CoworkThreadsSection } from "@/components/workspace/cowork/sidebar/CoworkThreadsSection";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  getEffectiveExpandedSidebarGroupKeys,
  isDefaultSidebarWorkspaceTypes,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar";
import { buildConfiguredCloudRepoKeys } from "@/lib/domain/workspaces/cloud-workspace-creation";
import {
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import {
  Archive,
  Calendar,
  Check,
  CollapseAll,
  ExpandAll,
  Filter,
  FolderPlusFilled,
  Grid,
  Home,
  CircleQuestion,
} from "@/components/ui/icons";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { APP_ROUTES } from "@/config/app-routes";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/use-cloud-billing";
import { useCloudRepoConfigs } from "@/hooks/cloud/use-cloud-repo-configs";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useSidebarSupportContext } from "@/hooks/support/use-sidebar-support-context";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceDisplayNameActions } from "@/hooks/workspaces/use-workspace-display-name-actions";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/use-workspace-sidebar-actions";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/use-workspace-sidebar-state";
import { useSessionActivityReconciler } from "@/hooks/sessions/use-session-activity-reconciler";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { RepoSetupModal } from "@/components/workspace/repo-setup/RepoSetupModal";
import {
  buildCloudRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import { startMeasurementOperation } from "@/lib/infra/debug-measurement";

const SIDEBAR_WORKSPACE_TYPE_OPTIONS: Array<{
  label: string;
  variant: SidebarWorkspaceVariant;
}> = [
  { label: "Local", variant: "local" },
  { label: "Worktrees", variant: "worktree" },
  { label: "Cloud", variant: "cloud" },
];

function removeRepoKeys(current: Set<string>, keys: Iterable<string>): Set<string> {
  const keysToRemove = new Set(keys);
  let changed = false;
  const next = new Set<string>();

  for (const key of current) {
    if (keysToRemove.has(key)) {
      changed = true;
      continue;
    }
    next.add(key);
  }

  return changed ? next : current;
}

export function MainSidebar() {
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
  const [showArchived, setShowArchived] = useState(false);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
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
  const {
    collapsedRepoGroups,
    setCollapsedRepoGroups,
    workspaceTypes,
    toggleSidebarWorkspaceType,
  } = useWorkspaceUiStore(useShallow((state) => ({
    collapsedRepoGroups: state.collapsedRepoGroups,
    setCollapsedRepoGroups: state.setCollapsedRepoGroups,
    workspaceTypes: state.workspaceTypes,
    toggleSidebarWorkspaceType: state.toggleSidebarWorkspaceType,
  })));
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
  const repoSetupModal = useRepoSetupModalStore((s) => s.modal);
  const closeRepoSetupModal = useRepoSetupModalStore((s) => s.close);
  const configuredCloudRepoKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(cloudRepoConfigs?.configs),
    [cloudRepoConfigs?.configs],
  );
  const cloudRepoConfigsInitialLoading = cloudActive
    && isCloudRepoConfigsPending
    && !cloudRepoConfigs;

  // Ephemeral, session-scoped set of repo keys the user has explicitly
  // expanded via "Show more". Toggles on/off. Resets on reload so the
  // 6-item default reasserts itself.
  const [explicitlyExpandedRepoKeys, setExplicitlyExpandedRepoKeys] = useState<
    Set<string>
  >(() => new Set());
  const collapsedRepoGroupKeys = useMemo(
    () => new Set(collapsedRepoGroups),
    [collapsedRepoGroups],
  );
  const handleToggleRepoExpansion = useCallback((sourceRoot: string) => {
    setExplicitlyExpandedRepoKeys((prev) => {
      const next = new Set(prev);
      if (next.has(sourceRoot)) {
        next.delete(sourceRoot);
      } else {
        next.add(sourceRoot);
      }
      return next;
    });
  }, []);
  const handleToggleRepoCollapsed = useCallback((sourceRoot: string) => {
    if (collapsedRepoGroupKeys.has(sourceRoot)) {
      setCollapsedRepoGroups(collapsedRepoGroups.filter((key) => key !== sourceRoot));
      return;
    }

    setCollapsedRepoGroups([...collapsedRepoGroups, sourceRoot]);
    setExplicitlyExpandedRepoKeys((prev) => removeRepoKeys(prev, [sourceRoot]));
  }, [collapsedRepoGroupKeys, collapsedRepoGroups, setCollapsedRepoGroups]);

  // Force-expand any group whose currently selected workspace would be
  // hidden by the cap, so the selection is always visible. Unions the
  // user's explicit expansions with the force-expansion set.
  const effectiveExpandedRepoKeys = useMemo(() => getEffectiveExpandedSidebarGroupKeys({
    groups,
    explicitlyExpandedRepoKeys,
    selectedLogicalWorkspaceId,
    itemLimit: DEFAULT_REPO_GROUP_ITEM_LIMIT,
  }), [explicitlyExpandedRepoKeys, groups, selectedLogicalWorkspaceId]);

  const handleRemoveRepo = useCallback((sourceRoot: string) => {
    const group = groups.find((g) => g.sourceRoot === sourceRoot);
    if (group) {
      unarchiveWorkspaces(group.allLogicalWorkspaceIds);
      if (group.repoRootId) {
        hideRepoRoot(group.repoRootId);
      }
    }
  }, [groups, hideRepoRoot, unarchiveWorkspaces]);

  const handleOpenRepoSettings = useCallback((sourceRoot: string) => {
    navigate(`/settings?section=repo&repo=${encodeURIComponent(sourceRoot)}`);
  }, [navigate]);
  const handleOpenCloudRepoSettings = useCallback((target: {
    gitOwner: string;
    gitRepoName: string;
  }) => {
    navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
  }, [navigate]);

  // Smart collapse toggle: if any repo group is currently expanded (i.e.
  // collapsedRepoGroups doesn't already contain every visible group key),
  // one click collapses them all. Otherwise, one click expands them all.
  const allRepoKeys = useMemo(
    () => groups.map((g) => g.sourceRoot),
    [groups],
  );
  const allRepoGroupsCollapsed =
    allRepoKeys.length > 0
    && allRepoKeys.every((key) => collapsedRepoGroups.includes(key));
  const handleToggleAllRepoGroups = useCallback(() => {
    if (allRepoGroupsCollapsed) {
      setCollapsedRepoGroups([]);
    } else {
      setCollapsedRepoGroups(allRepoKeys);
      setExplicitlyExpandedRepoKeys((prev) => removeRepoKeys(prev, allRepoKeys));
    }
  }, [allRepoGroupsCollapsed, allRepoKeys, setCollapsedRepoGroups]);

  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.startBlocked;
  const cloudWorkspaceTooltip = cloudUnavailable
    ? CAPABILITY_COPY.cloudDisabledTooltip
    : cloudWorkspaceBlocked
      ? `${titleForStartBlockReason(billingPlan?.startBlockReason)}.`
      : CAPABILITY_COPY.cloudSignInTooltip;
  const filtersActive = showArchived || !isDefaultSidebarWorkspaceTypes(workspaceTypes);

  return (
    <DebugProfiler id="workspace-sidebar">
      <div className="h-full bg-sidebar select-none flex flex-col gap-2 pb-2">
      <SupportDialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        context={supportContext}
      />
      <div className="flex flex-col flex-1 min-h-0 w-full min-w-0">
        {/* Top actions */}
        <div className="px-2">
          <div className="flex flex-col gap-px">
            <SidebarRowSurface
              active={isOnHome && !selectedWorkspaceId && !pendingWorkspaceEntry}
              onPress={actions.handleGoHome}
              className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
            >
              <div className="flex w-4 shrink-0 items-center justify-center">
                <Home className="size-3" />
              </div>
              <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-foreground">
                <span className="truncate">Home</span>
              </div>
            </SidebarRowSurface>
            <SidebarRowSurface
              active={isOnPlugins}
              onPress={actions.handleGoPlugins}
              className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
            >
              <div className="flex w-4 shrink-0 items-center justify-center">
                <Grid className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-foreground">
                <span className="truncate">Plugins</span>
              </div>
            </SidebarRowSurface>
            <SidebarRowSurface
              active={isOnAutomations}
              onPress={actions.handleGoAutomations}
              className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
            >
              <div className="flex w-4 shrink-0 items-center justify-center">
                <Calendar className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-foreground">
                <span className="truncate">Automations</span>
              </div>
            </SidebarRowSurface>
            <SidebarRowSurface
              active={supportOpen}
              onPress={() => setSupportOpen(true)}
              className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
            >
              <div className="flex w-4 shrink-0 items-center justify-center">
                <CircleQuestion className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-foreground">
                <span className="truncate">Support</span>
              </div>
            </SidebarRowSurface>
          </div>
        </div>

        <div className="relative overflow-hidden flex-1 w-full min-w-0 min-h-0">
          <AutoHideScrollArea
            className="h-full"
            viewportClassName="px-2 pt-0.5 pb-4"
            contentClassName="w-full min-w-0 flex flex-col gap-px"
          >
            <CoworkThreadsSection />
            <WorkspaceCleanupAttentionSection
              workspaces={cleanupAttentionWorkspaces}
              onRetryCleanup={actions.handleRetryWorkspaceCleanup}
            />

            {/* Repositories heading — text left-aligned with the row icon column (8px row-pl inside the 8px viewport gutter). */}
            <div className="text-foreground/50 text-base opacity-75 pl-2 pt-3 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span>Repositories</span>
                <div className="flex shrink-0 items-center gap-1">
                  {allRepoKeys.length > 0 && (
                    <SidebarActionButton
                      onClick={handleToggleAllRepoGroups}
                      title={allRepoGroupsCollapsed ? "Expand all repositories" : "Collapse all repositories"}
                      variant="section"
                    >
                      {allRepoGroupsCollapsed ? (
                        <ExpandAll className="size-3" />
                      ) : (
                        <CollapseAll className="size-3" />
                      )}
                    </SidebarActionButton>
                  )}
                  <PopoverButton
                    trigger={
                      <SidebarActionButton
                        title="Filter workspaces"
                        active={filtersActive}
                        variant="section"
                      >
                        <Filter className="size-3" />
                      </SidebarActionButton>
                    }
                  >
                    {() => (
                      <>
                        <PopoverMenuItem
                          onClick={() => {
                            setShowArchived((value) => !value);
                          }}
                          variant="sidebar"
                          icon={<Archive className="size-3.5 text-muted-foreground" />}
                          label="Archived workspaces"
                          trailing={showArchived ? <Check className="size-3.5 text-foreground/60" /> : null}
                        />
                        <div className="my-1 h-px bg-border" />
                        {SIDEBAR_WORKSPACE_TYPE_OPTIONS.map(({ label, variant }) => {
                          const selected = workspaceTypes.includes(variant);
                          const disabled = selected && workspaceTypes.length === 1;

                          return (
                            <PopoverMenuItem
                              key={variant}
                              onClick={() => {
                                toggleSidebarWorkspaceType(variant);
                              }}
                              disabled={disabled}
                              variant="sidebar"
                              icon={<SidebarWorkspaceVariantIcon variant={variant} className="size-3.5 text-muted-foreground" />}
                              label={label}
                              trailing={selected ? <Check className="size-3.5 text-foreground/60" /> : null}
                            />
                          );
                        })}
                      </>
                    )}
                  </PopoverButton>
                  <SidebarActionButton
                    onClick={actions.handleAddRepo}
                    title="Add repository"
                    variant="section"
                  >
                    <FolderPlusFilled className="size-3" />
                  </SidebarActionButton>
                </div>
              </div>
            </div>

            <SidebarWorkspaceContent
              emptyState={emptyState}
              isLoading={isLoading}
              groups={groups}
              collapsedRepoGroupKeys={collapsedRepoGroupKeys}
              explicitlyExpandedRepoKeys={explicitlyExpandedRepoKeys}
              effectiveExpandedRepoKeys={effectiveExpandedRepoKeys}
              onToggleRepoCollapsed={handleToggleRepoCollapsed}
              onToggleRepoExpansion={handleToggleRepoExpansion}
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
          </AutoHideScrollArea>
        </div>
      </div>

      <SidebarFooter />

      {repoSetupModal && (
        <RepoSetupModal
          repoRootId={repoSetupModal.repoRootId}
          sourceRoot={repoSetupModal.sourceRoot}
          repoName={repoSetupModal.repoName}
          onClose={closeRepoSetupModal}
        />
      )}
      </div>
    </DebugProfiler>
  );
}
