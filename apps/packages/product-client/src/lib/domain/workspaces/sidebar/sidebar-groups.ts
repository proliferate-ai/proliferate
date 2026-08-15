import type { GitStatusSnapshot, RepoRoot } from "@anyharness/sdk";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import type { SidebarSessionActivityState } from "#product/domain/sessions/activity";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { repoRootGroupKey } from "#product/lib/domain/workspaces/cloud/collections";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import { parseLogicalWorkspaceId } from "#product/lib/domain/workspaces/cloud/logical-workspace-id";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import type {
  SidebarGroupState,
} from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import {
  buildPendingSidebarProjection,
  type PendingSidebarProjection,
} from "#product/lib/domain/workspaces/sidebar/pending-sidebar-projection";
import { resolveSidebarWorkspaceTypes } from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import {
  compareLogicalWorkspaceRecency,
  compareResolvedLogicalWorkspaceRecency,
  type LogicalWorkspaceRecency,
  resolveLogicalWorkspaceRecency,
} from "#product/lib/domain/workspaces/sidebar/recency";
import {
  buildSidebarWorkspaceItems,
  pendingOwnsLogicalWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-items";

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
  repoConfigs?: readonly RepoConfigResponse[];
  logicalWorkspaces: LogicalWorkspace[];
  showArchived: boolean;
  workspaceTypes: ReturnType<typeof resolveSidebarWorkspaceTypes>;
  pinnedSet?: Set<string>;
  hiddenRepoRootIds: Set<string>;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  pendingWorkspaceEntries?: readonly PendingWorkspaceEntry[];
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  gitStatus: GitStatusSnapshot | undefined;
  gitStatusesByLogicalId?: Record<string, WorkspaceGitStatus>;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  sessionWorkspaceIds?: Record<string, string | null>;
  sessionLastInteracted?: Record<string, string>;
  sessionLastViewedAt?: Record<string, string>;
  suppressActiveNeedsReview?: boolean;
  desktopInstallId?: string | null;
}): SidebarGroupState[] {
  const visibleWorkspaceTypes = new Set(resolveSidebarWorkspaceTypes(args.workspaceTypes));
  const repoRootsByKey = new Map(
    args.repoRoots.map((repoRoot) => [repoRootGroupKey(repoRoot), repoRoot]),
  );
  const repoRootsById = new Map(args.repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const cloudRepoConfigsByKey = new Map(
    (args.repoConfigs ?? [])
      .filter((repoConfig) =>
        repoConfig.environments.some((environment) => environment.kind === "cloud")
      )
      .map((repoConfig) => [repoConfigGroupKey(repoConfig), repoConfig]),
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

  // Several launches can be in flight at once, so the sidebar projects every
  // live attempt, not just the attended one (PRO-230).
  const pendingProjectionsByRepoKey = new Map<string, PendingSidebarProjection[]>();
  // Suppression is keyed off the attempt's own materialized workspace id, not
  // off what the user has selected, and applies in EVERY group: an unattended
  // attempt whose real workspace has already landed in the collections cache
  // would otherwise render twice, once as its pending row and once as the real
  // row in whichever group that workspace sorts into.
  const pendingOwnedWorkspaceIds = new Set<string>();
  for (const entry of args.pendingWorkspaceEntries ?? []) {
    const projection = buildPendingSidebarProjection({
      entry,
      repoRootsById,
      selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
      selectedWorkspaceId: args.selectedWorkspaceId,
      activeSessionTitle: args.activeSessionTitle,
    });
    if (!projection) {
      continue;
    }
    if (entry.workspaceId) {
      pendingOwnedWorkspaceIds.add(entry.workspaceId);
    }
    const existing = pendingProjectionsByRepoKey.get(projection.repoKey);
    if (existing) {
      existing.push(projection);
    } else {
      pendingProjectionsByRepoKey.set(projection.repoKey, [projection]);
    }
  }

  const groupKeys = new Set<string>([
    ...repoRootsByKey.keys(),
    ...groups.keys(),
    ...pendingProjectionsByRepoKey.keys(),
    ...cloudRepoConfigsByKey.keys(),
  ]);

  return Array.from(groupKeys)
    .map((repoKey): { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } | null => {
      const rawGroupWorkspaces = groups.get(repoKey) ?? [];
      // A repo group may host several pending rows at once; launch order is
      // their order, and they stay above the materialized rows.
      const groupPendingProjections = pendingProjectionsByRepoKey.get(repoKey) ?? [];
      const groupPendingProjection = groupPendingProjections[0] ?? null;
      const pendingItems = groupPendingProjections.map((projection) => projection.item);
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
      const cloudRepoConfig = cloudRepoConfigsByKey.get(repoKey) ?? null;
      if (repoRoot && args.hiddenRepoRootIds.has(repoRoot.id)) {
        return null;
      }
      const workspaceItems = buildSidebarWorkspaceItems({
        workspaces: groupWorkspaces,
        pendingItems,
        pendingOwnedWorkspaceIds,
        pinnedSet: args.pinnedSet,
        selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
        selectedWorkspaceId: args.selectedWorkspaceId,
        workspaceActivities: args.workspaceActivities,
        pendingPromptCounts: args.pendingPromptCounts,
        gitStatus: args.gitStatus,
        gitStatusesByLogicalId: args.gitStatusesByLogicalId,
        activeSessionTitle: args.activeSessionTitle,
        lastViewedAt: args.lastViewedAt,
        workspaceLastInteracted: args.workspaceLastInteracted,
        sessionWorkspaceIds: args.sessionWorkspaceIds,
        sessionLastInteracted: args.sessionLastInteracted,
        sessionLastViewedAt: args.sessionLastViewedAt,
        suppressActiveNeedsReview: args.suppressActiveNeedsReview,
        desktopInstallId: args.desktopInstallId,
      });
      const items = pendingItems.length > 0
        ? [...pendingItems, ...workspaceItems]
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
      const latestPendingRecency = latestVisiblePendingRecency(
        groupPendingProjections,
        visibleItemIds,
      );
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

      const cloudSourceRoot = cloudRepoConfig
        ? `cloud:${cloudRepoConfig.gitOwner}/${cloudRepoConfig.gitRepoName}`
        : null;
      const sourceRoot = groupPendingProjection && !repoRoot
        ? groupPendingProjection.sourceRoot
        : repoRoot?.path
        ?? representative?.sourceRoot
        ?? cloudSourceRoot
        ?? repoKey;
      const name = repoRoot?.displayName?.trim()
        || repoRoot?.remoteRepoName?.trim()
        || groupPendingProjection?.name
        || cloudRepoConfig?.gitRepoName
        || (representative ? logicalGroupName(representative) : sourceRoot.split("/").filter(Boolean).pop())
        || sourceRoot;
      const provider = repoRoot?.remoteProvider ?? representative?.provider ?? cloudRepoConfig?.gitProvider ?? null;
      const owner = repoRoot?.remoteOwner ?? representative?.owner ?? cloudRepoConfig?.gitOwner ?? null;
      const repoName = repoRoot?.remoteRepoName ?? representative?.repoName ?? cloudRepoConfig?.gitRepoName ?? null;

      return {
        sortRecency,
        group: {
          sourceRoot,
          name,
          allLogicalWorkspaceIds: [
            ...pendingItems.map((item) => item.id),
            ...groupWorkspaces
              .filter((entry) =>
                !pendingItems.some((item) => item.id === entry.id)
                && !pendingOwnsLogicalWorkspace(pendingOwnedWorkspaceIds, entry)
              )
              .map((entry) => entry.id),
          ],
          repoRootId:
            repoRoot?.id
            ?? representative?.repoRoot?.id
            ?? groupPendingProjection?.repoRoot?.id
            ?? null,
          localSourceRoot:
            repoRoot?.path
            ?? groupWorkspaces.find((entry) => entry.localWorkspace)?.localWorkspace?.path
            ?? groupPendingProjection?.repoRoot?.path
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

function repoConfigGroupKey(repoConfig: Pick<
  RepoConfigResponse,
  "gitProvider" | "gitOwner" | "gitRepoName"
>): string {
  return `${repoConfig.gitProvider}:${repoConfig.gitOwner}:${repoConfig.gitRepoName}`;
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

function latestVisiblePendingRecency(
  projections: readonly PendingSidebarProjection[],
  visibleItemIds: Set<string>,
): LogicalWorkspaceRecency | null {
  let latestRecency: LogicalWorkspaceRecency | null = null;
  for (const projection of projections) {
    if (!visibleItemIds.has(projection.item.id)) {
      continue;
    }
    if (
      !latestRecency
      || compareResolvedLogicalWorkspaceRecency(projection.sortRecency, latestRecency) < 0
    ) {
      latestRecency = projection.sortRecency;
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
