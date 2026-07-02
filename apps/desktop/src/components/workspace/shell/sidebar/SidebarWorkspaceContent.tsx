import {
  resolveCloudRepoActionState,
  type CloudWorkspaceRepoTarget,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { cloudRepositoryKey } from "@/lib/domain/settings/repositories";
import {
  SIDEBAR_REPO_GROUP_ITEM_LIMIT,
  type SidebarEmptyState,
  type SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import { buildSidebarNewWorkspaceCommandScope } from "@/lib/domain/workspaces/creation/new-workspace-command";
import { visibleSidebarGroupItems } from "@/lib/domain/workspaces/sidebar/sidebar-visible-items";
import type { SidebarIndicatorAction } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import { useWorkspaceCopyActions } from "@/hooks/workspaces/workflows/use-workspace-copy-actions";
import { RepoGroup, type RepoGroupEnvironmentKind } from "./RepoGroup";
import { SidebarShowToggleRow } from "./SidebarShowToggleRow";
import { WorkspaceItem } from "./WorkspaceItem";

interface SidebarWorkspaceContentProps {
  emptyState: SidebarEmptyState;
  isLoading: boolean;
  groups: SidebarGroupState[];
  collapsedRepoGroupKeys: ReadonlySet<string>;
  repoGroupsShownMore: ReadonlySet<string>;
  onToggleRepoCollapsed: (sourceRoot: string) => void;
  onToggleRepoShowMore: (sourceRoot: string) => void;
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
  onOpenPullRequest: (url: string) => void;
  onMarkWorkspaceDone: (workspaceId: string, logicalWorkspaceId: string) => void;
  onWorkspaceHover?: () => void;
  shortcutRevealVisible: boolean;
  shortcutLabelByWorkspaceId: ReadonlyMap<string, string>;
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
    <div className="flex flex-col gap-1 px-3 py-3" aria-label="Loading workspaces" role="status">
      <SkeletonBlock className="h-7 w-full bg-sidebar-accent" />
      <SkeletonBlock className="h-7 w-[88%] bg-sidebar-accent/80" />
      <SkeletonBlock className="h-7 w-[72%] bg-sidebar-accent/70" />
      <p className="sr-only">Loading workspaces</p>
    </div>
  );
}

export function SidebarWorkspaceContent({
  emptyState,
  isLoading,
  groups,
  collapsedRepoGroupKeys,
  repoGroupsShownMore,
  onToggleRepoCollapsed,
  onToggleRepoShowMore,
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
  onOpenPullRequest,
  onMarkWorkspaceDone,
  onWorkspaceHover,
  shortcutRevealVisible,
  shortcutLabelByWorkspaceId,
  onArchiveWorkspace,
  onUnarchiveWorkspace,
  onRenameWorkspace,
  onRemoveRepo,
  onOpenRepoSettings,
}: SidebarWorkspaceContentProps) {
  const { copyWorkspaceLocation, copyBranchName } = useWorkspaceCopyActions();

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
    const overLimit = group.items.length > SIDEBAR_REPO_GROUP_ITEM_LIMIT;
    const isShownMore = repoGroupsShownMore.has(group.sourceRoot);
    const visibleItems = visibleSidebarGroupItems({
      group,
      isShownMore,
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    });
    const toggleLabel: "Show more" | "Show less" | null = !overLimit
      ? null
      : isShownMore
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
    const newWorkspaceCommandScope = buildSidebarNewWorkspaceCommandScope({
      sourceRoot: group.sourceRoot,
      localSourceRoot: group.localSourceRoot,
      repoRootId: group.repoRootId,
      cloudRepoTarget: group.cloudRepoTarget,
    });

    return (
      <RepoGroup
        key={`${group.sourceRoot}:${group.repoRootId ?? "no-repo-root"}:${groupIndex}`}
        name={group.name}
        count={group.items.length}
        collapsed={collapsedRepoGroupKeys.has(group.sourceRoot)}
        environmentKind={resolveRepoGroupEnvironmentKind(group, configuredCloudRepoKeys)}
        onToggleCollapsed={() => onToggleRepoCollapsed(group.sourceRoot)}
        onNewWorkspace={() => onCreateWorktreeWorkspace(group.repoRootId, group.sourceRoot)}
        onNewLocalWorkspace={() => onCreateLocalWorkspace(group.localSourceRoot, group.sourceRoot)}
        newWorkspaceCommandScope={newWorkspaceCommandScope}
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
              ? "Archived chats are available in Settings."
              : "This repository has no workspaces yet."}
          </p>
        ) : (
          <>
            {visibleItems.map((item) => (
              <WorkspaceItem
                key={item.id}
                workspaceId={item.id}
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
                branchName={item.branchName}
                gitStatus={item.gitStatus}
                needsReview={item.needsReview}
                shortcutLabel={shortcutLabelByWorkspaceId.get(item.id) ?? null}
                shortcutRevealVisible={shortcutRevealVisible}
                onSelect={() => onSelectWorkspace(item.id)}
                onIndicatorAction={onIndicatorAction}
                onOpenPullRequest={onOpenPullRequest}
                workspaceLocationCopyLabel={item.workspaceLocationCopyLabel}
                onCopyWorkspaceLocation={
                  item.workspaceLocationCopyValue && item.workspaceLocationCopyToastLabel
                    ? () => void copyWorkspaceLocation({
                      value: item.workspaceLocationCopyValue!,
                      menuLabel: item.workspaceLocationCopyLabel ?? "Copy workspace location",
                      toastLabel: item.workspaceLocationCopyToastLabel!,
                      missingLabel: "No workspace location to copy.",
                    })
                    : undefined
                }
                onCopyBranchName={
                  item.branchName
                    ? () => void copyBranchName(item.branchName)
                    : undefined
                }
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
                onClick={() => onToggleRepoShowMore(group.sourceRoot)}
              />
            )}
          </>
        )}
      </RepoGroup>
    );
  });
}

function resolveRepoGroupEnvironmentKind(
  group: SidebarGroupState,
  configuredCloudRepoKeys: ReadonlySet<string>,
): RepoGroupEnvironmentKind {
  const hasLocal = Boolean(group.localSourceRoot);
  const hasCloudWorkspace = group.items.some((item) => item.variant === "cloud");
  const hasConfiguredCloud = group.cloudRepoTarget
    ? configuredCloudRepoKeys.has(
      cloudRepositoryKey(group.cloudRepoTarget.gitOwner, group.cloudRepoTarget.gitRepoName),
    )
    : false;
  const hasCloud = hasCloudWorkspace || hasConfiguredCloud;

  if (hasCloud && !hasLocal) {
    return "cloud";
  }
  if (hasCloud) {
    return "local_cloud";
  }
  return "local";
}
