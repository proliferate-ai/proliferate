import type { SidebarSessionActivityState } from "@proliferate/product-model/sessions/activity";
import {
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceMatchesId,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  activeWorkspaceActivity,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
  type SidebarStatusIndicator,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { isWorkspaceNeedsReview } from "@/lib/domain/workspaces/sidebar/sidebar-review";
import { resolveLogicalWorkspaceRecency } from "@/lib/domain/workspaces/sidebar/recency";
import { resolveSidebarWorkspaceTypes } from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";

export type WorkspaceActivityIndicatorState = "idle" | "attention";

export interface WorkspaceActivityIndicatorSnapshot {
  state: WorkspaceActivityIndicatorState;
  attentionCount: number;
}

export interface BuildWorkspaceActivityIndicatorSnapshotArgs {
  logicalWorkspaces: readonly LogicalWorkspace[];
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  archivedSet: ReadonlySet<string>;
  hiddenRepoRootIds: ReadonlySet<string>;
  selectedLogicalWorkspaceId?: string | null;
  workspaceTypes: readonly SidebarWorkspaceVariant[] | null | undefined;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  sessionWorkspaceIds?: Readonly<Record<string, string | null | undefined>>;
  sessionActivities?: Readonly<Record<string, SidebarSessionActivityState>>;
  sessionLastInteracted?: Readonly<Record<string, string>>;
  sessionLastViewedAt?: Readonly<Record<string, string>>;
}

const ATTENTION_STATUS_KINDS: ReadonlySet<SidebarStatusIndicator["kind"]> = new Set([
  "error",
  "iterating",
  "waiting_input",
  "waiting_plan",
  "queued_prompt",
  "needs_review",
]);

const ATTENTION_SESSION_ACTIVITY_STATES: ReadonlySet<SidebarSessionActivityState> = new Set([
  "error",
  "iterating",
  "waiting_input",
  "waiting_plan",
]);

export function buildWorkspaceActivityIndicatorSnapshot(
  args: BuildWorkspaceActivityIndicatorSnapshotArgs,
): WorkspaceActivityIndicatorSnapshot {
  const visibleWorkspaceTypes = new Set(resolveSidebarWorkspaceTypes(args.workspaceTypes));
  let attentionCount = 0;

  for (const workspace of args.logicalWorkspaces) {
    const relatedIds = logicalWorkspaceRelatedIds(workspace);
    const relatedIdSet = new Set(relatedIds);
    const archived = isLogicalWorkspaceArchived(relatedIds, args.archivedSet);
    const active = logicalWorkspaceMatchesId(workspace, args.selectedLogicalWorkspaceId);
    const variant = sidebarWorkspaceVariantForLogicalWorkspace(workspace);
    if (
      archived
      || isLogicalWorkspaceRepoHidden(workspace, args.hiddenRepoRootIds)
      || (!active && !visibleWorkspaceTypes.has(variant))
    ) {
      continue;
    }

    const recency = resolveLogicalWorkspaceRecency(workspace, args.workspaceLastInteracted);
    const needsReview = isWorkspaceNeedsReview({
      isArchived: archived,
      lastInteracted: recency.displayAt,
      lastViewedAt: latestLogicalWorkspaceTimestamp(args.lastViewedAt, workspace),
    });
    const statusIndicator = sidebarStatusIndicatorFromActivity({
      activity: activeWorkspaceActivity(workspace, args.workspaceActivities),
      needsReview,
      pendingPromptCount: logicalWorkspaceRelatedCount(args.pendingPromptCounts, workspace),
    });

    if (
      needsReview
      || (statusIndicator && ATTENTION_STATUS_KINDS.has(statusIndicator.kind))
      || logicalWorkspaceHasAttentionSessionActivity(relatedIdSet, args)
      || logicalWorkspaceHasUnreadSessionActivity(relatedIdSet, args)
    ) {
      attentionCount += 1;
    }
  }

  return {
    state: attentionCount > 0 ? "attention" : "idle",
    attentionCount,
  };
}

function isLogicalWorkspaceArchived(
  relatedIds: readonly string[],
  archivedSet: ReadonlySet<string>,
): boolean {
  return relatedIds.some((id) => archivedSet.has(id));
}

function isLogicalWorkspaceRepoHidden(
  workspace: LogicalWorkspace,
  hiddenRepoRootIds: ReadonlySet<string>,
): boolean {
  return !!workspace.repoRoot?.id && hiddenRepoRootIds.has(workspace.repoRoot.id);
}

function logicalWorkspaceHasAttentionSessionActivity(
  relatedIds: ReadonlySet<string>,
  args: Pick<
    BuildWorkspaceActivityIndicatorSnapshotArgs,
    "sessionWorkspaceIds" | "sessionActivities"
  >,
): boolean {
  if (!args.sessionWorkspaceIds || !args.sessionActivities) {
    return false;
  }

  for (const [sessionId, workspaceId] of Object.entries(args.sessionWorkspaceIds)) {
    if (!workspaceId || !relatedIds.has(workspaceId)) {
      continue;
    }
    const activity = args.sessionActivities[sessionId];
    if (activity && ATTENTION_SESSION_ACTIVITY_STATES.has(activity)) {
      return true;
    }
  }
  return false;
}

function logicalWorkspaceHasUnreadSessionActivity(
  relatedIds: ReadonlySet<string>,
  args: Pick<
    BuildWorkspaceActivityIndicatorSnapshotArgs,
    "sessionWorkspaceIds" | "sessionLastInteracted" | "sessionLastViewedAt"
  >,
): boolean {
  if (!args.sessionWorkspaceIds || !args.sessionLastInteracted) {
    return false;
  }

  for (const [sessionId, workspaceId] of Object.entries(args.sessionWorkspaceIds)) {
    if (!workspaceId || !relatedIds.has(workspaceId)) {
      continue;
    }
    const lastInteracted = args.sessionLastInteracted[sessionId];
    if (!lastInteracted) {
      continue;
    }
    const lastViewed = args.sessionLastViewedAt?.[sessionId];
    if (!lastViewed || new Date(lastInteracted).getTime() > new Date(lastViewed).getTime()) {
      return true;
    }
  }
  return false;
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
