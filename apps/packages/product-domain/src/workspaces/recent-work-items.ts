import type {
  CloudSessionProjection,
  CloudWorkspaceLastSessionSummary,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

import type {
  BuildRecentWorkItemsOptions,
  RecentWorkItemView,
  RecentWorkRowKind,
} from "./cloud-work-inventory-types";
import { cloudWorkActivityPreview, recentWorkSourceForWorkspace } from "./cloud-work-items";
import {
  recentWorkCommandabilityLabel,
  recentWorkCloudAccessLabel,
  recentWorkRuntimeLabel,
  recentWorkOwnership,
  recentWorkOwnershipLabel,
  recentWorkSourceLabel,
  recentWorkStateLabel,
  sessionState,
  workspaceState,
} from "./cloud-work-labels";
import {
  recentWorkCloudAccessState,
  recentWorkCommandability,
  recentWorkRuntimeLocationForWorkspace,
} from "./cloud-work-runtime";
import {
  recentWorkStatusIndicatorForSession,
  recentWorkStatusIndicatorForWorkspace,
} from "./cloud-work-status";
import { cloudWorkLastActivityIso, dedupeCloudWorkspaces, parseTime, relativeTimeLabel } from "./cloud-work-time";
import { compactPreviewText } from "./cloud-work-text";

export function buildRecentWorkItems(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildRecentWorkItemsOptions = {},
): RecentWorkItemView[] {
  const nowMs = options.nowMs ?? Date.now();
  const activeWorkspaceId = options.activeWorkspaceId ?? null;
  const workspaceRows = dedupeCloudWorkspaces(workspaces);
  const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]));
  const rows = new Map<string, RecentWorkItemView>();
  const workspacesWithSessionRows = new Set<string>();

  for (const workspace of workspaceRows) {
    const summary = workspace.lastSessionSummary;
    if (!summary?.sessionId) {
      continue;
    }
    rows.set(
      recentSessionRowId(workspace.id, summary.sessionId),
      recentWorkItemForSessionSummary(workspace, summary, { nowMs }),
    );
    workspacesWithSessionRows.add(workspace.id);
  }

  for (const session of options.activeWorkspaceSessions ?? []) {
    const workspaceId = session.cloudWorkspaceId ?? "";
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) {
      continue;
    }
    rows.set(
      recentSessionRowId(workspace.id, session.sessionId),
      recentWorkItemForSessionProjection(workspace, session, { nowMs }),
    );
    workspacesWithSessionRows.add(workspace.id);
  }

  for (const workspace of workspaceRows) {
    if (workspacesWithSessionRows.has(workspace.id) && workspace.id !== activeWorkspaceId) {
      continue;
    }
    rows.set(recentWorkspaceRowId(workspace.id), recentWorkItemForWorkspace(workspace, { nowMs }));
  }

  const sorted = [...rows.values()].sort(compareRecentWorkItems);
  return typeof options.limit === "number" ? sorted.slice(0, options.limit) : sorted;
}

function recentWorkItemForWorkspace(
  workspace: CloudWorkspaceSummary,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: cloudWorkLastActivityIso(workspace) });
  const state = workspaceState(workspace);
  return {
    ...base,
    id: recentWorkspaceRowId(workspace.id),
    rowKind: "workspace",
    workspaceId: workspace.id,
    sessionId: null,
    openTarget: { kind: "workspace", workspaceId: workspace.id },
    title: workspace.displayName ?? workspace.repo.name,
    subtitle: "Workspace",
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForWorkspace(workspace),
    activityPreview: cloudWorkActivityPreview(workspace),
    searchText: recentSearchText(base, [workspace.displayName, workspace.repo.name, "workspace"]),
  };
}

function recentWorkItemForSessionSummary(
  workspace: CloudWorkspaceSummary,
  summary: CloudWorkspaceLastSessionSummary,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: summary.lastEventAt ?? cloudWorkLastActivityIso(workspace) });
  const state = sessionState(summary.status, workspace);
  const activityPreview = compactPreviewText(summary.preview);
  return {
    ...base,
    id: recentSessionRowId(workspace.id, summary.sessionId),
    rowKind: "session",
    workspaceId: workspace.id,
    sessionId: summary.sessionId,
    openTarget: { kind: "session", workspaceId: workspace.id, sessionId: summary.sessionId },
    title: summary.title ?? summary.preview ?? workspace.displayName ?? workspace.repo.name,
    subtitle: `${workspace.displayName ?? workspace.repo.name} session`,
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForSession(workspace, summary.status, summary),
    activityPreview,
    searchText: recentSearchText(base, [summary.title, activityPreview, workspace.displayName, workspace.repo.name, "session"]),
  };
}

function recentWorkItemForSessionProjection(
  workspace: CloudWorkspaceSummary,
  session: CloudSessionProjection,
  options: { nowMs: number },
): RecentWorkItemView {
  const base = recentWorkBase(workspace, { nowMs: options.nowMs, rowActivityAt: session.lastEventAt ?? session.startedAt ?? cloudWorkLastActivityIso(workspace) });
  const state = sessionState(session.status, workspace);
  return {
    ...base,
    id: recentSessionRowId(workspace.id, session.sessionId),
    rowKind: "session",
    workspaceId: workspace.id,
    sessionId: session.sessionId,
    openTarget: { kind: "session", workspaceId: workspace.id, sessionId: session.sessionId },
    title: session.title ?? workspace.displayName ?? workspace.repo.name,
    subtitle: `${workspace.displayName ?? workspace.repo.name} session`,
    state,
    stateLabel: recentWorkStateLabel(state),
    statusIndicator: recentWorkStatusIndicatorForSession(workspace, session.status, session),
    activityPreview: null,
    searchText: recentSearchText(base, [session.title, session.sourceAgentKind, workspace.displayName, workspace.repo.name, "session"]),
  };
}

function recentWorkBase(
  workspace: CloudWorkspaceSummary,
  options: { nowMs: number; rowActivityAt: string | null },
): Omit<
  RecentWorkItemView,
  | "id"
  | "rowKind"
  | "workspaceId"
  | "sessionId"
  | "pendingSessionKey"
  | "openTarget"
  | "title"
  | "subtitle"
  | "state"
  | "stateLabel"
  | "statusIndicator"
  | "activityPreview"
  | "searchText"
> {
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const cloudAccessState = recentWorkCloudAccessState(workspace);
  const commandability = recentWorkCommandability(workspace);
  const ownership = recentWorkOwnership(workspace);
  const lastActivityMs = parseTime(options.rowActivityAt);
  return {
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    sourceKind,
    sourceLabel: recentWorkSourceLabel(sourceKind),
    runtimeLocation,
    runtimeLabel: recentWorkRuntimeLabel(runtimeLocation),
    cloudAccessState,
    cloudAccessLabel: recentWorkCloudAccessLabel(cloudAccessState),
    commandability,
    commandabilityLabel: recentWorkCommandabilityLabel(commandability),
    ownership,
    ownershipLabel: recentWorkOwnershipLabel(ownership),
    lastActivityAt: options.rowActivityAt,
    lastActivityMs,
    lastActivityLabel: relativeTimeLabel(lastActivityMs, options.nowMs),
  };
}

function compareRecentWorkItems(left: RecentWorkItemView, right: RecentWorkItemView): number {
  const recencyDelta = right.lastActivityMs - left.lastActivityMs;
  if (recencyDelta !== 0) {
    return recencyDelta;
  }
  const kindDelta = recentRowKindRank(left.rowKind) - recentRowKindRank(right.rowKind);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  return left.title.localeCompare(right.title);
}

function recentRowKindRank(kind: RecentWorkRowKind): number {
  switch (kind) {
    case "pending-session":
      return 0;
    case "session":
      return 1;
    case "workspace":
      return 2;
  }
}

function recentSearchText(
  base: Pick<
    RecentWorkItemView,
    | "repoLabel"
    | "branchLabel"
    | "sourceLabel"
    | "runtimeLabel"
    | "cloudAccessLabel"
    | "commandabilityLabel"
    | "ownershipLabel"
  >,
  values: readonly (string | null | undefined)[],
): string {
  return [
    ...values,
    base.repoLabel,
    base.branchLabel,
    base.sourceLabel,
    base.runtimeLabel,
    base.cloudAccessLabel,
    base.commandabilityLabel,
    base.ownershipLabel,
  ].filter(Boolean).join(" ");
}

function recentWorkspaceRowId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

function recentSessionRowId(workspaceId: string, sessionId: string): string {
  return `session:${workspaceId}:${sessionId}`;
}
