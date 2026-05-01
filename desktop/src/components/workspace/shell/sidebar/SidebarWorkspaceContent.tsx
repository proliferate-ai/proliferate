import {
  resolveCloudRepoActionState,
  type CloudWorkspaceRepoTarget,
} from "@/lib/domain/workspaces/cloud-workspace-creation";
import type {
  SidebarEmptyState,
  SidebarGroupState,
  SidebarIndicatorAction,
} from "@/lib/domain/workspaces/sidebar";
import { BrailleSweepBadge } from "@/components/ui/icons";
import { RepoGroup } from "./RepoGroup";
import { SidebarShowToggleRow } from "./SidebarShowToggleRow";
import { WorkspaceItem } from "./WorkspaceItem";

export const DEFAULT_REPO_GROUP_ITEM_LIMIT = 6;

interface SidebarWorkspaceContentProps {
  emptyState: SidebarEmptyState;
  isLoading: boolean;
  groups: SidebarGroupState[];
  collapsedRepoGroupKeys: ReadonlySet<string>;
  /**
   * Groups the user has explicitly expanded via "Show more". Used to decide
   * whether to show a "Show less" toggle (forced expansions get no toggle).
   */
  explicitlyExpandedRepoKeys: Set<string>;
  /**
   * Effective expansion set — union of explicit expansions and groups
   * force-expanded because the selected workspace is past the cap. Used
   * for slicing.
   */
  effectiveExpandedRepoKeys: Set<string>;
  onToggleRepoCollapsed: (sourceRoot: string) => void;
  onToggleRepoExpansion: (sourceRoot: string) => void;
  configuredCloudRepoKeys: ReadonlySet<string>;
  cloudRepoConfigsInitialLoading: boolean;
  cloudWorkspaceEnabled: boolean;
  cloudWorkspaceTooltip: string;
  onCreateWorktreeWorkspace: (repoRootId: string | null, repoGroupKeyToExpand: string) => void;
  onCreateLocalWorkspace: (sourceRoot: string | null, repoGroupKeyToExpand: string) => void;
  onCreateCloudWorkspace: (
    target: CloudWorkspaceRepoTarget,
    repoGroupKeyToExpand: string,
  ) => void;
  onOpenCloudRepoSettings: (target: CloudWorkspaceRepoTarget) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onIndicatorAction: (action: SidebarIndicatorAction) => void;
  onMarkWorkspaceDone: (workspaceId: string, logicalWorkspaceId: string) => void;
  onWorkspaceHover?: () => void;
  onArchiveWorkspace: (workspaceId: string) => void;
  onUnarchiveWorkspace: (workspaceId: string) => void;
  onRenameWorkspace: (
    workspaceId: string,
    displayName: string | null,
  ) => Promise<unknown>;
  onRemoveRepo: (sourceRoot: string) => void;
  onOpenRepoSettings: (sourceRoot: string) => void;
}

function SidebarLoadingState() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
      <BrailleSweepBadge className="text-base text-foreground" />
      <p className="text-xs text-sidebar-muted-foreground">Loading workspaces</p>
    </div>
  );
}

export function SidebarWorkspaceContent({
  emptyState,
  isLoading,
  groups,
  collapsedRepoGroupKeys,
  explicitlyExpandedRepoKeys,
  effectiveExpandedRepoKeys,
  onToggleRepoCollapsed,
  onToggleRepoExpansion,
  configuredCloudRepoKeys,
  cloudRepoConfigsInitialLoading,
  cloudWorkspaceEnabled,
  cloudWorkspaceTooltip,
  onCreateWorktreeWorkspace,
  onCreateLocalWorkspace,
  onCreateCloudWorkspace,
  onOpenCloudRepoSettings,
  onSelectWorkspace,
  onIndicatorAction,
  onMarkWorkspaceDone,
  onWorkspaceHover,
  onArchiveWorkspace,
  onUnarchiveWorkspace,
  onRenameWorkspace,
  onRemoveRepo,
  onOpenRepoSettings,
}: SidebarWorkspaceContentProps) {
  if (isLoading && emptyState === "noWorkspaces") {
    return <SidebarLoadingState />;
  }

  if (emptyState === "noWorkspaces") {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-xs text-sidebar-muted-foreground">
          No workspaces yet
        </p>
        <p className="text-xs text-sidebar-muted-foreground mt-1">
          Add a repository to get started
        </p>
      </div>
    );
  }

  if (emptyState === "filteredOut") {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-xs text-sidebar-muted-foreground">
          No workspaces match the current filters
        </p>
        <p className="text-xs text-sidebar-muted-foreground mt-1">
          Adjust the sidebar filters to show more workspaces
        </p>
      </div>
    );
  }

  return groups.map((group, groupIndex) => {
    const overLimit = group.items.length > DEFAULT_REPO_GROUP_ITEM_LIMIT;
    const isExplicitlyExpanded = explicitlyExpandedRepoKeys.has(group.sourceRoot);
    const isEffectivelyExpanded = effectiveExpandedRepoKeys.has(group.sourceRoot);
    const isForceExpanded = isEffectivelyExpanded && !isExplicitlyExpanded;
    const shouldTruncate = overLimit && !isEffectivelyExpanded;
    const visibleItems = shouldTruncate
      ? group.items.slice(0, DEFAULT_REPO_GROUP_ITEM_LIMIT)
      : group.items;
    // Hide toggle entirely when force-expanded: clicking would be a no-op
    // since selection would immediately re-expand the group.
    const toggleLabel: "Show more" | "Show less" | null = !overLimit
      ? null
      : isForceExpanded
        ? null
        : isExplicitlyExpanded
          ? "Show less"
          : "Show more";
    const cloudRepoAction = resolveCloudRepoActionState({
      repoTarget: group.cloudRepoTarget,
      configuredRepoKeys: configuredCloudRepoKeys,
      isInitialConfigLoad: cloudRepoConfigsInitialLoading,
    });
    const cloudRepoTarget = group.cloudRepoTarget;
    const hasArchivedHiddenItems =
      group.items.length === 0 && group.allLogicalWorkspaceIds.length > 0;

    return (
      <RepoGroup
        key={`${group.sourceRoot}:${group.repoRootId ?? "no-repo-root"}:${groupIndex}`}
        name={group.name}
        count={group.items.length}
        collapsed={collapsedRepoGroupKeys.has(group.sourceRoot)}
        onToggleCollapsed={() => onToggleRepoCollapsed(group.sourceRoot)}
        onNewWorkspace={() => onCreateWorktreeWorkspace(group.repoRootId, group.sourceRoot)}
        onNewLocalWorkspace={() => onCreateLocalWorkspace(group.localSourceRoot, group.sourceRoot)}
        cloudWorkspaceEnabled={cloudWorkspaceEnabled && cloudRepoAction.kind !== "loading"}
        cloudWorkspaceTooltip={
          cloudRepoAction.kind === "loading"
            ? "Loading cloud configuration..."
            : cloudWorkspaceTooltip
        }
        cloudWorkspaceLabel={cloudRepoAction.label ?? undefined}
        onCloudWorkspaceAction={cloudRepoTarget
          ? () => {
            if (cloudRepoAction.kind === "create") {
              onCreateCloudWorkspace(cloudRepoTarget, group.sourceRoot);
              return;
            }
            if (cloudRepoAction.kind === "configure") {
              onOpenCloudRepoSettings(cloudRepoTarget);
            }
          }
          : undefined}
        onRemoveRepo={() => onRemoveRepo(group.sourceRoot)}
        onOpenSettings={() => onOpenRepoSettings(group.sourceRoot)}
      >
        {group.items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
            {hasArchivedHiddenItems
              ? "Archived workspaces are hidden."
              : "This repository has no workspaces yet."}
          </p>
        ) : (
          <>
            {visibleItems.map((item) => (
              <WorkspaceItem
                key={item.id}
                name={item.name}
                defaultName={item.defaultName}
                hasDisplayNameOverride={item.hasDisplayNameOverride}
                subtitle={item.subtitle}
                active={item.active}
                archived={item.archived}
                variant={item.variant}
                statusIndicator={item.statusIndicator}
                detailIndicators={item.detailIndicators}
                cloudStatus={item.cloudStatus}
                lastInteracted={item.lastInteracted}
                onSelect={() => onSelectWorkspace(item.id)}
                onIndicatorAction={onIndicatorAction}
                onMarkDone={
                  item.variant === "worktree" && !item.archived && item.localWorkspaceId
                    ? () => onMarkWorkspaceDone(item.localWorkspaceId!, item.id)
                    : undefined
                }
                onHover={onWorkspaceHover}
                onArchive={item.archived ? undefined : () => onArchiveWorkspace(item.id)}
                onUnarchive={item.archived ? () => onUnarchiveWorkspace(item.id) : undefined}
                onRename={
                  item.renameSupported
                    ? (displayName) => onRenameWorkspace(item.id, displayName)
                    : undefined
                }
              />
            ))}
            {toggleLabel && (
              <SidebarShowToggleRow
                label={toggleLabel}
                onClick={() => onToggleRepoExpansion(group.sourceRoot)}
              />
            )}
          </>
        )}
      </RepoGroup>
    );
  });
}
