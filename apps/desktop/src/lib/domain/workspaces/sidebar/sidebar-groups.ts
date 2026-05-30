import type { GitStatusSnapshot, RepoRoot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceMatchesId,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { repoRootGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { humanizeBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import { workspaceDefaultDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import { parseLogicalWorkspaceId } from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  activeWorkspaceActivity,
  detailIndicatorsForWorkspace,
  logicalWorkspaceSshTargetId,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type { SidebarCloudWorkspaceStatus } from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import { cloudSidebarEntryDefaultDisplayName } from "@/lib/domain/workspaces/sidebar/sidebar-entries";
import type {
  SidebarGroupState,
  SidebarWorkspaceItemState,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import { buildPendingSidebarProjection } from "@/lib/domain/workspaces/sidebar/pending-sidebar-projection";
import { resolveSidebarWorkspaceTypes } from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { isWorkspaceNeedsReview } from "@/lib/domain/workspaces/sidebar/sidebar-review";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";
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
  targetAppearanceById?: Record<string, ComputeTargetAppearance>;
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
      const workspaceItemsWithWorkspace = groupWorkspaces.map((entry) => {
        const active = logicalWorkspaceMatchesId(entry, args.selectedLogicalWorkspaceId);
        const cloudOnlyArchived = !entry.localWorkspace
          && entry.cloudWorkspace?.productLifecycle === "archived";
        const archived = cloudOnlyArchived
          || logicalWorkspaceRelatedIds(entry).some((id) => args.archivedSet.has(id));
        const recency = resolveLogicalWorkspaceRecency(entry, args.workspaceLastInteracted);
        const activityLastInteracted = recency.displayAt;
        const lastInteracted = activityLastInteracted ?? recency.recordUpdatedAt;
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
          lastInteracted: activityLastInteracted,
          lastViewedAt: latestLogicalWorkspaceTimestamp(args.lastViewedAt, entry),
        });
        const activity = activeWorkspaceActivity(entry, args.workspaceActivities);
        const copyMetadata = workspaceCopyMetadataForLogicalWorkspace(entry);
        const sshTargetId = variant === "ssh" ? logicalWorkspaceSshTargetId(entry) : null;
        const targetAppearance = sshTargetId
          ? args.targetAppearanceById?.[sshTargetId] ?? null
          : null;

        return {
          workspace: entry,
          item: {
            id: entry.id,
            localWorkspaceId: preferredLocalWorkspace?.id ?? null,
            cloudWorkspaceId: preferredCloudWorkspace?.id ?? null,
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
              pendingPromptCount: logicalWorkspaceRelatedCount(args.pendingPromptCounts, entry),
              errorAction: { kind: "open_workspace", workspaceId: entry.id },
            }),
            detailIndicators: detailIndicatorsForWorkspace(
              entry,
              variant,
              targetAppearance,
            ),
            cloudStatus: preferredCloudWorkspace
              ? preferredCloudWorkspace.status as SidebarCloudWorkspaceStatus
              : null,
            lastInteracted,
            needsReview,
            workspaceLocationCopyLabel: copyMetadata.workspaceLocation?.menuLabel ?? null,
            workspaceLocationCopyValue: copyMetadata.workspaceLocation?.value ?? null,
            workspaceLocationCopyToastLabel: copyMetadata.workspaceLocation?.toastLabel ?? null,
            branchName: copyMetadata.branchName,
          },
        };
      });
      const workspaceItems = applyDuplicateLocalNameSuffixes(
        pendingItem
          ? workspaceItemsWithWorkspace.filter(({ workspace, item }) =>
            item.id !== pendingItem.id
            && !pendingOwnsLogicalWorkspace(pendingOwnedWorkspaceId, workspace)
          )
          : workspaceItemsWithWorkspace,
      );
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
            ?? groupWorkspaces.find((entry) => entry.localWorkspace)?.localWorkspace?.sourceRepoRootPath
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

function logicalWorkspaceRelatedCount(
  counts: Record<string, number> | undefined,
  workspace: LogicalWorkspace,
): number {
  if (!counts) {
    return 0;
  }
  return logicalWorkspaceRelatedIds(workspace).reduce(
    (total, id) => total + (counts[id] ?? 0),
    0,
  );
}

function pendingOwnsLogicalWorkspace(
  pendingWorkspaceId: string | null,
  workspace: LogicalWorkspace,
): boolean {
  return Boolean(
    pendingWorkspaceId
    && logicalWorkspaceMatchesId(workspace, pendingWorkspaceId),
  );
}

function applyDuplicateLocalNameSuffixes(
  entries: Array<{
    workspace: LogicalWorkspace;
    item: SidebarWorkspaceItemState;
  }>,
): SidebarWorkspaceItemState[] {
  const localEntriesByName = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.workspace.localWorkspace) {
      continue;
    }
    const byName = localEntriesByName.get(entry.item.name);
    if (byName) {
      byName.push(entry);
    } else {
      localEntriesByName.set(entry.item.name, [entry]);
    }
  }

  const suffixById = new Map<string, number>();
  for (const duplicateEntries of localEntriesByName.values()) {
    if (duplicateEntries.length < 2) {
      continue;
    }
    [...duplicateEntries]
      .sort((left, right) => compareDuplicateLocalNameOrder(left.workspace, right.workspace))
      .forEach((entry, index) => {
        if (index > 0) {
          suffixById.set(entry.workspace.id, index + 1);
        }
      });
  }

  return entries.map(({ workspace, item }) => {
    const suffix = suffixById.get(workspace.id);
    return suffix
      ? { ...item, name: `${item.name} #${suffix}` }
      : item;
  });
}

function compareDuplicateLocalNameOrder(left: LogicalWorkspace, right: LogicalWorkspace): number {
  const leftWorkspace = left.localWorkspace;
  const rightWorkspace = right.localWorkspace;
  const byCreatedAt =
    new Date(leftWorkspace?.createdAt ?? left.updatedAt).getTime()
    - new Date(rightWorkspace?.createdAt ?? right.updatedAt).getTime();
  if (byCreatedAt !== 0) {
    return byCreatedAt;
  }
  return left.id.localeCompare(right.id);
}
