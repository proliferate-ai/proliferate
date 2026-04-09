import type { NewCloudWorkspaceSeed } from "@/lib/domain/workspaces/cloud-workspace-creation";
import type {
  SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar";
import { BrailleSweepBadge } from "@/components/ui/icons";
import { RepoGroup } from "./RepoGroup";
import { WorkspaceItem } from "./WorkspaceItem";

export const DEFAULT_REPO_GROUP_ITEM_LIMIT = 6;

interface SidebarWorkspaceContentProps {
  isEmpty: boolean;
  isLoading: boolean;
  groups: SidebarGroupState[];
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
  onToggleRepoExpansion: (sourceRoot: string) => void;
  cloudWorkspaceEnabled: boolean;
  cloudWorkspaceTooltip: string;
  onCreateWorktreeWorkspace: (repoWorkspaceId: string | null) => void;
  onCreateLocalWorkspace: (sourceRoot: string | null) => void;
  onOpenCloudDialog: (cloudDialogState: NewCloudWorkspaceSeed) => void;
  onSelectWorkspace: (workspaceId: string) => void;
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
  isEmpty,
  isLoading,
  groups,
  explicitlyExpandedRepoKeys,
  effectiveExpandedRepoKeys,
  onToggleRepoExpansion,
  cloudWorkspaceEnabled,
  cloudWorkspaceTooltip,
  onCreateWorktreeWorkspace,
  onCreateLocalWorkspace,
  onOpenCloudDialog,
  onSelectWorkspace,
  onArchiveWorkspace,
  onUnarchiveWorkspace,
  onRenameWorkspace,
  onRemoveRepo,
  onOpenRepoSettings,
}: SidebarWorkspaceContentProps) {
  if (isLoading && isEmpty) {
    return <SidebarLoadingState />;
  }

  if (isEmpty) {
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

  return groups.map((group) => {
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

    return (
      <RepoGroup
        key={group.sourceRoot}
        name={group.name}
        sourceRoot={group.sourceRoot}
        count={group.items.length}
        onNewWorkspace={() => onCreateWorktreeWorkspace(group.repoWorkspaceId)}
        onNewLocalWorkspace={() => onCreateLocalWorkspace(group.localSourceRoot)}
        cloudWorkspaceEnabled={cloudWorkspaceEnabled}
        cloudWorkspaceTooltip={cloudWorkspaceTooltip}
        onNewCloudWorkspace={
          group.cloudDialogState
            ? (() => {
              const cloudDialogState = group.cloudDialogState;
              return () => onOpenCloudDialog(cloudDialogState);
            })()
            : undefined
        }
        onRemoveRepo={() => onRemoveRepo(group.sourceRoot)}
        onOpenSettings={() => onOpenRepoSettings(group.sourceRoot)}
      >
        {group.items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
            This workspace has no sessions.
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
                activity={item.activity}
                variant={item.variant}
                cloudStatus={item.cloudStatus}
                additions={item.additions}
                deletions={item.deletions}
                lastInteracted={item.lastInteracted}
                unread={item.unread}
                onSelect={() => onSelectWorkspace(item.id)}
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
              <ShowToggleRow
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

function ShowToggleRow({
  label,
  onClick,
}: {
  label: "Show more" | "Show less";
  onClick: () => void;
}) {
  return (
    <div className="pl-6 pr-2 pt-0.5 pb-1">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-transparent px-2 py-0.5 text-sm leading-[18px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-offset-2"
      >
        {label}
      </button>
    </div>
  );
}
