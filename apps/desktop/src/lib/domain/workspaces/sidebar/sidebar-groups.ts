import type { GitStatusSnapshot, RepoRoot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { repoRootGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { parseLogicalWorkspaceId } from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type {
  SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import { buildPendingSidebarProjection } from "@/lib/domain/workspaces/sidebar/pending-sidebar-projection";
import { resolveSidebarWorkspaceTypes } from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import {
  compareLogicalWorkspaceRecency,
  compareResolvedLogicalWorkspaceRecency,
  type LogicalWorkspaceRecency,
  resolveLogicalWorkspaceRecency,
} from "@/lib/domain/workspaces/sidebar/recency";
import {
  buildSidebarWorkspaceItems,
  pendingOwnsLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-workspace-items";

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
    const selectedIndex = group.items.findIndex((item) =>
      sidebarItemMatchesId(item, selectedLogicalWorkspaceId)
    );
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
  pendingWorkspaceEntry?: PendingWorkspaceEntry | null;
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  gitStatus: GitStatusSnapshot | undefined;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  sessionWorkspaceIds?: Record<string, string | null>;
  sessionLastInteracted?: Record<string, string>;
  sessionLastViewedAt?: Record<string, string>;
  targetAppearanceById?: Record<string, ComputeTargetAppearance>;
  suppressActiveNeedsReview?: boolean;
}): SidebarGroupState[] {
  const visibleWorkspaceTypes = new Set(resolveSidebarWorkspaceTypes(args.workspaceTypes));
  const repoRootsByKey = new Map(
    args.repoRoots.map((repoRoot) => [repoRootGroupKey(repoRoot), repoRoot]),
  );
  const repoRootsById = new Map(args.repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const groups = new Map<string, LogicalWorkspace[]>();
  for (const workspace of args.logicalWorkspaces) {
    const entries = groups.get(workspace.repoKey);
    if (entries) {
      entries.push(workspace);
    } else {
      groups.set(workspace.repoKey, [workspace]);
    }
  }

  const pendingProjection = args.pendingWorkspaceEntry
    ? buildPendingSidebarProjection({
      entry: args.pendingWorkspaceEntry,
      repoRootsById,
      selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
      selectedWorkspaceId: args.selectedWorkspaceId,
      activeSessionTitle: args.activeSessionTitle,
    })
    : null;

  const groupKeys = new Set<string>([
    ...repoRootsByKey.keys(),
    ...groups.keys(),
    ...(pendingProjection ? [pendingProjection.repoKey] : []),
  ]);

  return Array.from(groupKeys)
    .map((repoKey): { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } | null => {
      const rawGroupWorkspaces = groups.get(repoKey) ?? [];
      const pendingItem =
        pendingProjection?.repoKey === repoKey ? pendingProjection.item : null;
      const pendingOwnedWorkspaceId = pendingItem
        ? args.pendingWorkspaceEntry?.workspaceId ?? null
        : null;
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
      const workspaceItems = buildSidebarWorkspaceItems({
        workspaces: groupWorkspaces,
        pendingItem,
        pendingOwnedWorkspaceId,
        archivedSet: args.archivedSet,
        selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
        selectedWorkspaceId: args.selectedWorkspaceId,
        workspaceActivities: args.workspaceActivities,
        pendingPromptCounts: args.pendingPromptCounts,
        gitStatus: args.gitStatus,
        activeSessionTitle: args.activeSessionTitle,
        lastViewedAt: args.lastViewedAt,
        workspaceLastInteracted: args.workspaceLastInteracted,
        sessionWorkspaceIds: args.sessionWorkspaceIds,
        sessionLastInteracted: args.sessionLastInteracted,
        sessionLastViewedAt: args.sessionLastViewedAt,
        targetAppearanceById: args.targetAppearanceById,
        suppressActiveNeedsReview: args.suppressActiveNeedsReview,
      });
      const items = pendingItem
        ? [pendingItem, ...workspaceItems]
        : workspaceItems;
      const visibleItems = items.filter((item) => {
        if (args.showArchived) {
          return item.archived && visibleWorkspaceTypes.has(item.variant);
        }
        if (item.archived) {
          return false;
        }
        if (item.active) {
          return true;
        }
        return visibleWorkspaceTypes.has(item.variant);
      });
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
      const latestWorkspaceRecency = latestVisibleWorkspaceRecency(
        groupWorkspaces,
        visibleItemIds,
        args.workspaceLastInteracted,
      );
      const latestPendingRecency =
        pendingItem && visibleItemIds.has(pendingItem.id) ? pendingProjection!.sortRecency : null;
      const sortRecency = latestPendingRecency && (
        !latestWorkspaceRecency
        || compareResolvedLogicalWorkspaceRecency(latestPendingRecency, latestWorkspaceRecency) < 0
      )
        ? latestPendingRecency
        : latestWorkspaceRecency ?? {
        activityAt: null,
        recordUpdatedAt: repoRoot?.updatedAt ?? "",
        sortAt: repoRoot?.updatedAt ?? "",
        displayAt: null,
      };

      const sourceRoot = pendingProjection?.repoKey === repoKey && !repoRoot
        ? pendingProjection.sourceRoot
        : repoRoot?.path
        ?? representative?.sourceRoot
        ?? repoKey;
      const name = repoRoot?.displayName?.trim()
        || repoRoot?.remoteRepoName?.trim()
        || (pendingProjection?.repoKey === repoKey ? pendingProjection.name : null)
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
          allLogicalWorkspaceIds: [
            ...(pendingItem ? [pendingItem.id] : []),
            ...groupWorkspaces
              .filter((entry) =>
                entry.id !== pendingItem?.id
                && !pendingOwnsLogicalWorkspace(pendingOwnedWorkspaceId, entry)
              )
              .map((entry) => entry.id),
          ],
          repoRootId:
            repoRoot?.id
            ?? representative?.repoRoot?.id
            ?? (pendingProjection?.repoKey === repoKey ? pendingProjection.repoRoot?.id : null)
            ?? null,
          localSourceRoot:
            repoRoot?.path
            ?? groupWorkspaces.find((entry) => entry.localWorkspace)?.localWorkspace?.path
            ?? (pendingProjection?.repoKey === repoKey ? pendingProjection.repoRoot?.path : null)
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

function sidebarItemMatchesId(
  item: { id: string; localWorkspaceId: string | null },
  candidateId: string | null,
): boolean {
  if (!candidateId) {
    return false;
  }
  if (candidateId === item.id || candidateId === item.localWorkspaceId) {
    return true;
  }
  const parsed = parseLogicalWorkspaceId(candidateId);
  if (parsed?.kind !== "local-slot" || !item.localWorkspaceId) {
    return false;
  }
  return parsed.segments[0] === item.localWorkspaceId;
}
