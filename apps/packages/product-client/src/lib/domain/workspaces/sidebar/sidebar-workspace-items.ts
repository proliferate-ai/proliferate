import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "#product/domain/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceMatchesId,
  logicalWorkspaceRelatedIds,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { humanizeBranchName } from "#product/lib/domain/workspaces/creation/branch-naming";
import { workspaceDefaultDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import { cloudSidebarEntryDefaultDisplayName } from "#product/lib/domain/workspaces/sidebar/sidebar-entries";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { isWorkspaceDirectoryMissing } from "#product/lib/domain/workspaces/availability";
import {
  activeWorkspaceActivity,
  sidebarGitAttentionIndicator,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
  worktreeMissingStatusIndicator,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { isWorkspaceNeedsReview } from "#product/lib/domain/workspaces/sidebar/sidebar-review";
import { logicalWorkspaceHasUnreadSessionActivity } from "#product/lib/domain/workspaces/sidebar/workspace-activity-indicator";
import { workspaceCopyMetadataForLogicalWorkspace } from "#product/lib/domain/workspaces/workspace-copy-metadata";
import { resolveLogicalWorkspaceRecency } from "#product/lib/domain/workspaces/sidebar/recency";
import {
  deriveWorkspaceAvailabilityInput,
  resolveWorkspaceAvailabilityCommands,
} from "#product/lib/domain/workspaces/cloud/workspace-availability-commands";
import { canonicalRepoKey } from "#product/domain/repos/repo-id";

export interface SidebarWorkspaceItemWithWorkspace {
  workspace: LogicalWorkspace;
  item: SidebarWorkspaceItemState;
}

export function buildSidebarWorkspaceItems(args: {
  workspaces: LogicalWorkspace[];
  pendingItems: readonly SidebarWorkspaceItemState[];
  /** Materialized ids owned by live pending attempts, from any repo group. */
  pendingOwnedWorkspaceIds: ReadonlySet<string>;
  pinnedSet?: Set<string>;
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
  suppressActiveNeedsReview?: boolean;
  /** This Mac's native desktop worker install id (PR 5), used to resolve the
   * workspace-copy availability commands. Null on Web / no worker. */
  desktopInstallId?: string | null;
  /** Whether Cloud compute is enabled on this deployment (PRO-10); gates the
   * `add-cloud-copy` availability command the same way fresh-create is
   * gated. */
  cloudComputeEnabled: boolean;
}): SidebarWorkspaceItemState[] {
  const linkCandidateCloudWorkspaceIds = collectCloudWorkspaceLinkCandidates(
    args.workspaces,
    args.desktopInstallId ?? null,
  );
  const workspaceItemsWithWorkspace = args.workspaces.map((entry) =>
    buildSidebarWorkspaceItem(entry, { ...args, linkCandidateCloudWorkspaceIds })
  );

  // Suppression runs whenever any attempt is live, not just when this group
  // hosts a pending row: an attempt's materialized workspace can sort into a
  // different repo group than its pending projection (PRO-230).
  const hasPendingSuppression =
    args.pendingItems.length > 0 || args.pendingOwnedWorkspaceIds.size > 0;
  return applyDuplicateLocalNameSuffixes(
    hasPendingSuppression
      ? workspaceItemsWithWorkspace.filter(({ workspace, item }) =>
        !args.pendingItems.some((pendingItem) => pendingItem.id === item.id)
        && !pendingOwnsLogicalWorkspace(args.pendingOwnedWorkspaceIds, workspace)
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
  pendingWorkspaceIds: ReadonlySet<string>,
  workspace: LogicalWorkspace,
): boolean {
  for (const pendingWorkspaceId of pendingWorkspaceIds) {
    if (logicalWorkspaceMatchesId(workspace, pendingWorkspaceId)) {
      return true;
    }
  }
  return false;
}

function buildSidebarWorkspaceItem(
  entry: LogicalWorkspace,
  args: {
    selectedLogicalWorkspaceId: string | null;
    selectedWorkspaceId: string | null;
    pinnedSet?: Set<string>;
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
    linkCandidateCloudWorkspaceIds: ReadonlySet<string>;
    cloudComputeEnabled: boolean;
  },
): SidebarWorkspaceItemWithWorkspace {
  const active = logicalWorkspaceMatchesId(entry, args.selectedLogicalWorkspaceId);
  const archived = !entry.localWorkspace
    && entry.cloudWorkspace?.productLifecycle === "archived";
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

  // Workspace-copy availability commands (PR 5). A logical workspace that has
  // both a local and a Cloud side without an explicit materialization for this
  // install is a plausible Link candidate (same repo/branch heuristic already
  // grouped them).
  const gitStatus = args.gitStatusesByLogicalId?.[entry.id] ?? null;
  const desktopInstallId = args.desktopInstallId ?? null;
  const cloudSummary = entry.cloudWorkspace;
  const linkCandidate = Boolean(
    cloudSummary
    && args.linkCandidateCloudWorkspaceIds.has(cloudSummary.id),
  );
  const availabilityCommands = resolveWorkspaceAvailabilityCommands(
      deriveWorkspaceAvailabilityInput({
        localWorkspace: preferredLocalWorkspace ?? null,
        cloudWorkspace: cloudSummary ?? null,
        desktopInstallId,
        localGitStatus: gitStatus,
        linkCandidate,
        cloudComputeEnabled: args.cloudComputeEnabled,
      }),
    );
  const linkedMaterialization = desktopInstallId
    ? (cloudSummary?.materializations ?? []).find(
      (m) => m.targetKind === "local_desktop" && m.desktopInstallId === desktopInstallId,
    ) ?? null
    : null;

  // The status cell's whole precedence, in one place: a missing checkout
  // outranks everything, then live session activity, then whatever git
  // attention the identity glyph's state dot does not already carry.
  const statusIndicator = entry.localWorkspace
      && isWorkspaceDirectoryMissing(entry.localWorkspace)
    ? worktreeMissingStatusIndicator(
      entry.localWorkspace.kind,
      { kind: "open_workspace", workspaceId: entry.id },
    )
    : (sidebarStatusIndicatorFromActivity({
      activity,
      pendingPromptCount: logicalWorkspaceRelatedCount(args.pendingPromptCounts, entry),
      errorAction: { kind: "open_workspace", workspaceId: entry.id },
    }) ?? sidebarGitAttentionIndicator(gitStatus));

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
      pinnedIds: logicalWorkspaceRelatedIds(entry).filter((id) => args.pinnedSet?.has(id)),
      variant,
      statusIndicator,
      lastInteracted,
      needsReview,
      workspaceLocationCopyLabel: copyMetadata.workspaceLocation?.menuLabel ?? null,
      workspaceLocationCopyValue: copyMetadata.workspaceLocation?.value ?? null,
      workspaceLocationCopyToastLabel: copyMetadata.workspaceLocation?.toastLabel ?? null,
      branchName: copyMetadata.branchName,
      // Already on the workspace record the collections query fetches — no
      // extra request. Absent on cloud summaries, which carry no execution
      // summary in this projection.
      sessionCount: preferredLocalWorkspace?.executionSummary?.totalSessionCount ?? null,
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
