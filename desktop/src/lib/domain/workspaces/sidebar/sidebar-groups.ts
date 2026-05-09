import type { GitStatusSnapshot, RepoRoot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { repoRootGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import { humanizeBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import { workspaceDefaultDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import {
  activeWorkspaceActivity,
  detailIndicatorsForWorkspace,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { SidebarCloudWorkspaceStatus } from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import { cloudSidebarEntryDefaultDisplayName } from "@/lib/domain/workspaces/sidebar/sidebar-entries";
import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar-model";
import {
  resolveSidebarWorkspaceTypes,
} from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { isWorkspaceNeedsReview } from "@/lib/domain/workspaces/sidebar/sidebar-review";
import {
  compareLogicalWorkspaceRecency,
  compareResolvedLogicalWorkspaceRecency,
  type LogicalWorkspaceRecency,
  resolveLogicalWorkspaceRecency,
} from "@/lib/domain/workspaces/sidebar/recency";

function logicalGroupName(workspace: LogicalWorkspace): string {
  return workspace.repoName
    ?? workspace.sourceRoot.split("/").filter(Boolean).pop()
    ?? workspace.sourceRoot;
}

export function resolveAutoShowMoreRepoKey(args: {
  groups: SidebarGroupState[];
  selectedLogicalWorkspaceId: string | null;
  itemLimit: number;
}): string | null {
  const {
    groups,
    selectedLogicalWorkspaceId,
    itemLimit,
  } = args;

  if (!selectedLogicalWorkspaceId) {
    return null;
  }

  for (const group of groups) {
    if (group.items.length <= itemLimit) continue;
    const selectedIndex = group.items.findIndex((item) => item.id === selectedLogicalWorkspaceId);
    if (selectedIndex >= itemLimit) {
      return group.sourceRoot;
    }
  }

  return null;
}

export function resolveSidebarEmptyState(
  logicalWorkspaceCount: number,
  groupCount: number,
): "noWorkspaces" | "filteredOut" | null {
  if (groupCount > 0) {
    return null;
  }

  if (logicalWorkspaceCount === 0) {
    return "noWorkspaces";
  }

  return "filteredOut";
}

export function buildSidebarGroupStates(args: {
  repoRoots: RepoRoot[];
  logicalWorkspaces: LogicalWorkspace[];
  showArchived: boolean;
  workspaceTypes: ReturnType<typeof resolveSidebarWorkspaceTypes>;
  archivedSet: Set<string>;
  hiddenRepoRootIds: Set<string>;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  gitStatus: GitStatusSnapshot | undefined;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  finishSuggestionsByWorkspaceId?: Record<string, { workspaceId: string; readinessFingerprint: string }>;
}): SidebarGroupState[] {
  const visibleWorkspaceTypes = new Set(resolveSidebarWorkspaceTypes(args.workspaceTypes));
  const repoRootsByKey = new Map(
    args.repoRoots.map((repoRoot) => [repoRootGroupKey(repoRoot), repoRoot]),
  );
  const groups = new Map<string, LogicalWorkspace[]>();
  for (const workspace of args.logicalWorkspaces) {
    const entries = groups.get(workspace.repoKey);
    if (entries) {
      entries.push(workspace);
    } else {
      groups.set(workspace.repoKey, [workspace]);
    }
  }

  const groupKeys = new Set<string>([
    ...repoRootsByKey.keys(),
    ...groups.keys(),
  ]);

  return Array.from(groupKeys)
    .map((repoKey): { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } | null => {
      const rawGroupWorkspaces = groups.get(repoKey) ?? [];
      const groupWorkspaces = groupHasWorkActivity(
        rawGroupWorkspaces,
        args.workspaceLastInteracted,
      )
        ? [...rawGroupWorkspaces].sort((left, right) =>
          compareLogicalWorkspaceRecency(left, right, args.workspaceLastInteracted)
        )
        : rawGroupWorkspaces;
      const representative = groupWorkspaces[0] ?? null;
      const repoRoot = representative?.repoRoot ?? repoRootsByKey.get(repoKey) ?? null;
      if (repoRoot && args.hiddenRepoRootIds.has(repoRoot.id)) {
        return null;
      }
      const items = groupWorkspaces.map((entry) => {
        const active = entry.id === args.selectedLogicalWorkspaceId;
        const archived = args.archivedSet.has(entry.id);
        const recency = resolveLogicalWorkspaceRecency(entry, args.workspaceLastInteracted);
        const lastInteracted = recency.displayAt;
        const preferredLocalWorkspace = entry.localWorkspace;
        const preferredCloudWorkspace = entry.cloudWorkspace;
        const variant = sidebarWorkspaceVariantForLogicalWorkspace(entry);
        const displayNameOverride = preferredLocalWorkspace?.displayName?.trim()
          || preferredCloudWorkspace?.displayName?.trim()
          || null;
        const defaultName = preferredLocalWorkspace
          ? (
            active && args.selectedWorkspaceId === preferredLocalWorkspace.id && args.gitStatus?.currentBranch
              ? humanizeBranchName(args.gitStatus.currentBranch)
              : workspaceDefaultDisplayName(preferredLocalWorkspace)
          )
          : preferredCloudWorkspace
            ? cloudSidebarEntryDefaultDisplayName({
              source: "cloud",
              id: entry.id,
              cloudWorkspaceId: preferredCloudWorkspace.id,
              repoKey: entry.repoKey,
              workspace: preferredCloudWorkspace,
            })
            : entry.displayName;
        const needsReview = isWorkspaceNeedsReview({
          isArchived: archived,
          lastInteracted,
          lastViewedAt: latestLogicalWorkspaceTimestamp(args.lastViewedAt, entry),
        });
        const activity = activeWorkspaceActivity(entry, args.workspaceActivities);

        return {
          id: entry.id,
          localWorkspaceId: preferredLocalWorkspace?.id ?? null,
          name: displayNameOverride ?? defaultName,
          defaultName,
          hasDisplayNameOverride: displayNameOverride !== null,
          renameSupported: !(entry.localWorkspace && entry.cloudWorkspace),
          subtitle: active ? args.activeSessionTitle : null,
          active,
          archived,
          variant,
          statusIndicator: sidebarStatusIndicatorFromActivity({
            activity,
            needsReview,
            pendingPromptCount: args.pendingPromptCounts?.[entry.id] ?? 0,
            errorAction: { kind: "open_workspace", workspaceId: entry.id },
          }),
          detailIndicators: detailIndicatorsForWorkspace(
            entry,
            variant,
            preferredLocalWorkspace
              ? args.finishSuggestionsByWorkspaceId?.[preferredLocalWorkspace.id] ?? null
              : null,
          ),
          cloudStatus: preferredCloudWorkspace
            ? preferredCloudWorkspace.status as SidebarCloudWorkspaceStatus
            : null,
          lastInteracted,
          needsReview,
        };
      });
      const visibleItems = items.filter((item) =>
        item.active
        || ((args.showArchived || !item.archived) && visibleWorkspaceTypes.has(item.variant))
      );
      const archiveHiddenItems = items.filter((item) =>
        !item.active
        && item.archived
        && visibleWorkspaceTypes.has(item.variant)
      );
      if (visibleItems.length === 0 && groupWorkspaces.length > 0) {
        if (!repoRoot || archiveHiddenItems.length === 0) {
          return null;
        }
      }
      const visibleItemIds = new Set(visibleItems.map((item) => item.id));
      const sortRecency = latestVisibleWorkspaceRecency(
        groupWorkspaces,
        visibleItemIds,
        args.workspaceLastInteracted,
      ) ?? {
        activityAt: null,
        recordUpdatedAt: repoRoot?.updatedAt ?? "",
        sortAt: repoRoot?.updatedAt ?? "",
        displayAt: null,
      };

      const sourceRoot = repoRoot?.path
        ?? representative?.sourceRoot
        ?? repoKey;
      const name = repoRoot?.displayName?.trim()
        || repoRoot?.remoteRepoName?.trim()
        || (representative ? logicalGroupName(representative) : sourceRoot.split("/").filter(Boolean).pop())
        || sourceRoot;
      const provider = repoRoot?.remoteProvider ?? representative?.provider ?? null;
      const owner = repoRoot?.remoteOwner ?? representative?.owner ?? null;
      const repoName = repoRoot?.remoteRepoName ?? representative?.repoName ?? null;

      return {
        sortRecency,
        group: {
          sourceRoot,
          name,
          allLogicalWorkspaceIds: groupWorkspaces.map((entry) => entry.id),
          repoRootId:
            repoRoot?.id
            ?? representative?.repoRoot?.id
            ?? null,
          localSourceRoot:
            repoRoot?.path
            ?? groupWorkspaces.find((entry) => entry.localWorkspace)?.localWorkspace?.sourceRepoRootPath
            ?? null,
          cloudRepoTarget:
            provider === "github" && owner && repoName
              ? {
                gitOwner: owner,
                gitRepoName: repoName,
              }
              : null,
          items: visibleItems,
        },
      };
    })
    .filter((entry): entry is { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } =>
      entry !== null)
    .sort((a, b) => compareResolvedLogicalWorkspaceRecency(a.sortRecency, b.sortRecency))
    .map((entry) => entry.group);
}

function latestVisibleWorkspaceRecency(
  workspaces: LogicalWorkspace[],
  visibleItemIds: Set<string>,
  workspaceActivityAt: Record<string, string>,
): LogicalWorkspaceRecency | null {
  let latestRecency: LogicalWorkspaceRecency | null = null;
  for (const workspace of workspaces) {
    if (!visibleItemIds.has(workspace.id)) {
      continue;
    }
    const recency = resolveLogicalWorkspaceRecency(workspace, workspaceActivityAt);
    if (!latestRecency || compareResolvedLogicalWorkspaceRecency(recency, latestRecency) < 0) {
      latestRecency = recency;
    }
  }
  return latestRecency;
}

function groupHasWorkActivity(
  workspaces: LogicalWorkspace[],
  workspaceActivityAt: Record<string, string>,
): boolean {
  return workspaces.some((workspace) =>
    resolveLogicalWorkspaceRecency(workspace, workspaceActivityAt).activityAt !== null
  );
}
