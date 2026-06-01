import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceMatchesId,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { humanizeBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import { workspaceDefaultDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type { SidebarCloudWorkspaceStatus } from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import { cloudSidebarEntryDefaultDisplayName } from "@/lib/domain/workspaces/sidebar/sidebar-entries";
import type { SidebarWorkspaceItemState } from "@/lib/domain/workspaces/sidebar/sidebar-model";
import {
  activeWorkspaceActivity,
  logicalWorkspaceSshTargetId,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { detailIndicatorsForWorkspace } from "@/lib/domain/workspaces/sidebar/sidebar-detail-indicators";
import { isWorkspaceNeedsReview } from "@/lib/domain/workspaces/sidebar/sidebar-review";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";
import { resolveLogicalWorkspaceRecency } from "@/lib/domain/workspaces/sidebar/recency";

export interface SidebarWorkspaceItemWithWorkspace {
  workspace: LogicalWorkspace;
  item: SidebarWorkspaceItemState;
}

export function buildSidebarWorkspaceItems(args: {
  workspaces: LogicalWorkspace[];
  pendingItem: SidebarWorkspaceItemState | null;
  pendingOwnedWorkspaceId: string | null;
  archivedSet: Set<string>;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  gitStatus: GitStatusSnapshot | undefined;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  targetAppearanceById?: Record<string, ComputeTargetAppearance>;
}): SidebarWorkspaceItemState[] {
  const workspaceItemsWithWorkspace = args.workspaces.map((entry) =>
    buildSidebarWorkspaceItem(entry, args)
  );

  return applyDuplicateLocalNameSuffixes(
    args.pendingItem
      ? workspaceItemsWithWorkspace.filter(({ workspace, item }) =>
        item.id !== args.pendingItem?.id
        && !pendingOwnsLogicalWorkspace(args.pendingOwnedWorkspaceId, workspace)
      )
      : workspaceItemsWithWorkspace,
  );
}

export function pendingOwnsLogicalWorkspace(
  pendingWorkspaceId: string | null,
  workspace: LogicalWorkspace,
): boolean {
  return Boolean(
    pendingWorkspaceId
    && logicalWorkspaceMatchesId(workspace, pendingWorkspaceId),
  );
}

function buildSidebarWorkspaceItem(
  entry: LogicalWorkspace,
  args: {
    selectedLogicalWorkspaceId: string | null;
    selectedWorkspaceId: string | null;
    archivedSet: Set<string>;
    workspaceActivities: Record<string, SidebarSessionActivityState>;
    pendingPromptCounts?: Record<string, number>;
    gitStatus: GitStatusSnapshot | undefined;
    activeSessionTitle: string | null;
    lastViewedAt: Record<string, string>;
    workspaceLastInteracted: Record<string, string>;
    targetAppearanceById?: Record<string, ComputeTargetAppearance>;
  },
): SidebarWorkspaceItemWithWorkspace {
  const active = logicalWorkspaceMatchesId(entry, args.selectedLogicalWorkspaceId);
  const cloudOnlyArchived = !entry.localWorkspace
    && entry.cloudWorkspace?.productLifecycle === "archived";
  const archived = cloudOnlyArchived
    || logicalWorkspaceRelatedIds(entry).some((id) => args.archivedSet?.has(id));
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

function applyDuplicateLocalNameSuffixes(
  entries: SidebarWorkspaceItemWithWorkspace[],
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
