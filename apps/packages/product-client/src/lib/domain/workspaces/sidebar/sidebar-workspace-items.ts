import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceMatchesId,
  logicalWorkspaceRelatedIds,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { humanizeBranchName } from "#product/lib/domain/workspaces/creation/branch-naming";
import { workspaceDefaultDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import type { ComputeTargetAppearance } from "#product/lib/domain/compute/target-appearance";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import type { SidebarCloudWorkspaceStatus } from "#product/lib/domain/workspaces/sidebar/cloud-workspace";
import { cloudSidebarEntryDefaultDisplayName } from "#product/lib/domain/workspaces/sidebar/sidebar-entries";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { isWorkspaceDirectoryMissing } from "#product/lib/domain/workspaces/availability";
import {
  activeWorkspaceActivity,
  logicalWorkspaceSshTargetId,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
  worktreeMissingStatusIndicator,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { detailIndicatorsForWorkspace } from "#product/lib/domain/workspaces/sidebar/sidebar-detail-indicators";
import { isWorkspaceNeedsReview } from "#product/lib/domain/workspaces/sidebar/sidebar-review";
import { logicalWorkspaceHasUnreadSessionActivity } from "#product/lib/domain/workspaces/sidebar/workspace-activity-indicator";
import { workspaceCopyMetadataForLogicalWorkspace } from "#product/lib/domain/workspaces/workspace-copy-metadata";
import { resolveLogicalWorkspaceRecency } from "#product/lib/domain/workspaces/sidebar/recency";
import {
  deriveWorkspaceAvailabilityInput,
  resolveWorkspaceAvailabilityCommands,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";

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
  gitStatusesByLogicalId?: Record<string, WorkspaceGitStatus>;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  sessionWorkspaceIds?: Record<string, string | null>;
  sessionLastInteracted?: Record<string, string>;
  sessionLastViewedAt?: Record<string, string>;
  targetAppearanceById?: Record<string, ComputeTargetAppearance>;
  suppressActiveNeedsReview?: boolean;
  /** This Mac's native desktop worker install id (PR 5), used to resolve the
   * workspace-copy availability commands. Null on Web / no worker. */
  desktopInstallId?: string | null;
}): SidebarWorkspaceItemState[] {
  const linkCandidateCloudWorkspaceIds = collectCloudWorkspaceLinkCandidates(
    args.workspaces,
    args.desktopInstallId ?? null,
  );
  const workspaceItemsWithWorkspace = args.workspaces.map((entry) =>
    buildSidebarWorkspaceItem(entry, { ...args, linkCandidateCloudWorkspaceIds })
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

/** Cloud ledger rows intentionally keep an unlinked Cloud workspace in its own
 * logical slot. Find same-repository, same-case-sensitive-branch local slots
 * across the whole projection so that production-shaped managed rows can still
 * offer the explicit Link copies action (PR5-LINK-10). */
export function collectCloudWorkspaceLinkCandidates(
  workspaces: LogicalWorkspace[],
  desktopInstallId: string | null,
): Set<string> {
  const localSlots = workspaces.filter((workspace) => workspace.localWorkspace !== null);
  const result = new Set<string>();
  for (const cloudSlot of workspaces) {
    const cloud = cloudSlot.cloudWorkspace;
    if (!cloud || cloudSlot.localWorkspace) continue;
    const alreadyLinked = desktopInstallId
      ? (cloud.materializations ?? []).some(
        (row) => row.targetKind === "local_desktop"
          && row.desktopInstallId === desktopInstallId,
      )
      : false;
    if (alreadyLinked || !cloudSlot.provider || !cloudSlot.owner || !cloudSlot.repoName) continue;
    const cloudRepoKey = canonicalRepoKey(
      cloudSlot.provider,
      cloudSlot.owner,
      cloudSlot.repoName,
    );
    const matches = localSlots.some((localSlot) => (
      localSlot.provider
      && localSlot.owner
      && localSlot.repoName
      && canonicalRepoKey(localSlot.provider, localSlot.owner, localSlot.repoName) === cloudRepoKey
      && localSlot.branchKey === cloudSlot.branchKey
    ));
    if (matches) result.add(cloud.id);
  }
  return result;
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
    gitStatusesByLogicalId?: Record<string, WorkspaceGitStatus>;
    activeSessionTitle: string | null;
    lastViewedAt: Record<string, string>;
    workspaceLastInteracted: Record<string, string>;
    sessionWorkspaceIds?: Record<string, string | null>;
    sessionLastInteracted?: Record<string, string>;
    sessionLastViewedAt?: Record<string, string>;
    targetAppearanceById?: Record<string, ComputeTargetAppearance>;
    suppressActiveNeedsReview?: boolean;
    desktopInstallId?: string | null;
    linkCandidateCloudWorkspaceIds: ReadonlySet<string>;
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
  // The session tabs' blue dot and the sidebar row must agree: a related
  // session with unseen activity marks the row even when the workspace is
  // the active one (the user may be on a different tab).
  const hasUnreadSessions = !archived
    && logicalWorkspaceHasUnreadSessionActivity(
      new Set(logicalWorkspaceRelatedIds(entry)),
      args,
    );
  // A workspace the user is actively viewing in a focused window has nothing
  // pending review, even when the viewed timestamp briefly trails the latest
  // interaction (e.g. right after a new session bootstraps).
  const needsReview = hasUnreadSessions
    || (!(active && args.suppressActiveNeedsReview)
      && isWorkspaceNeedsReview({
        isArchived: archived,
        lastInteracted: activityLastInteracted,
        lastViewedAt: latestLogicalWorkspaceTimestamp(args.lastViewedAt, entry),
      }));
  const activity = activeWorkspaceActivity(entry, args.workspaceActivities);
  const copyMetadata = workspaceCopyMetadataForLogicalWorkspace(entry);
  const sshTargetId = variant === "ssh" ? logicalWorkspaceSshTargetId(entry) : null;
  const targetAppearance = sshTargetId
    ? args.targetAppearanceById?.[sshTargetId] ?? null
    : null;

  // Workspace-copy availability commands (PR 5). A logical workspace that has
  // both a local and a Cloud side without an explicit materialization for this
  // install is a plausible Link candidate (same repo/branch heuristic already
  // grouped them). SSH direct-target workspaces are out of PR 5 scope.
  const gitStatus = args.gitStatusesByLogicalId?.[entry.id] ?? null;
  const desktopInstallId = args.desktopInstallId ?? null;
  const cloudSummary = entry.cloudWorkspace;
  const linkCandidate = Boolean(
    variant !== "ssh"
    && cloudSummary
    && args.linkCandidateCloudWorkspaceIds.has(cloudSummary.id),
  );
  const availabilityCommands = variant === "ssh"
    ? []
    : resolveWorkspaceAvailabilityCommands(
      deriveWorkspaceAvailabilityInput({
        localWorkspace: preferredLocalWorkspace ?? null,
        cloudWorkspace: cloudSummary ?? null,
        desktopInstallId,
        localGitStatus: gitStatus,
        linkCandidate,
      }),
    );
  const linkedMaterialization = desktopInstallId
    ? (cloudSummary?.materializations ?? []).find(
      (m) => m.targetKind === "local_desktop" && m.desktopInstallId === desktopInstallId,
    ) ?? null
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
      statusIndicator: entry.localWorkspace && isWorkspaceDirectoryMissing(entry.localWorkspace)
        ? worktreeMissingStatusIndicator(
          entry.localWorkspace.kind,
          { kind: "open_workspace", workspaceId: entry.id },
        )
        : sidebarStatusIndicatorFromActivity({
          activity,
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
      gitStatus,
      availabilityCommands,
      cloudWorkspaceIdForActions: cloudSummary?.id ?? null,
      linkedMaterializationId: linkedMaterialization?.id ?? null,
      repoOwner: entry.owner ?? cloudSummary?.repo?.owner ?? null,
      repoName: entry.repoName ?? cloudSummary?.repo?.name ?? null,
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
