import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import {
  recentWorkCloudAccessLabel,
  recentWorkCloudAccessState,
  recentWorkCommandability,
  recentWorkCommandabilityLabel,
  recentWorkRuntimeLabel,
  recentWorkRuntimeLocationForWorkspace,
  recentWorkSourceForWorkspace,
  recentWorkSourceLabel,
} from "./cloud-work-inventory";
import type {
  WorkspaceInventoryItemView,
  WorkspaceInventoryLocationKind,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventoryStatusKind,
} from "./inventory";

export function cloudWorkspaceInventoryItem(
  workspace: CloudWorkspaceSummary,
  now: number,
): WorkspaceInventoryItemView {
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const cloudAccessState = recentWorkCloudAccessState(workspace);
  const commandability = recentWorkCommandability(workspace);
  const sessionLabel =
    nonEmptyText(workspace.lastSessionSummary?.title) ??
    nonEmptyText(workspace.lastSessionSummary?.preview);

  return {
    id: workspace.id,
    title: workspaceDisplayLabel(workspace),
    repoLabel: repoLabel(workspace),
    branchLabel: workspaceBranchLabel(workspace),
    sourceKind,
    sourceLabel: recentWorkSourceLabel(sourceKind),
    locationKind: workspaceLocationKind(workspace),
    locationLabel: workspaceLocationLabel(workspace),
    runtimeLocation,
    runtimeLocationLabel: recentWorkRuntimeLabel(runtimeLocation),
    cloudAccessState,
    cloudAccessLabel: recentWorkCloudAccessLabel(cloudAccessState),
    commandability,
    commandabilityLabel: recentWorkCommandabilityLabel(commandability),
    scopeLabel: workspaceScopeLabel(workspace),
    statusKind: workspaceStatusKind(workspace),
    statusLabel: workspaceStatusLabel(workspace),
    ownershipKind: workspaceOwnershipKind(workspace),
    ownerLabel: workspaceOwnerLabel(workspace),
    exposureLabel: workspaceExposureLabel(workspace.exposureState ?? null),
    sessionLabel,
    updatedLabel: formatShortRelativeTime(workspaceLastActivityAt(workspace), now),
    active: false,
  };
}

export function sortedCloudWorkspaces(
  workspaces: readonly CloudWorkspaceSummary[],
): CloudWorkspaceSummary[] {
  return [...workspaces].sort((left, right) => {
    const leftTime = dateSortValue(workspaceLastActivityAt(left));
    const rightTime = dateSortValue(workspaceLastActivityAt(right));
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const titleComparison = workspaceDisplayLabel(left).localeCompare(
      workspaceDisplayLabel(right),
    );
    if (titleComparison !== 0) {
      return titleComparison;
    }
    const repoComparison = repoLabel(left).localeCompare(repoLabel(right));
    if (repoComparison !== 0) {
      return repoComparison;
    }
    return left.id.localeCompare(right.id);
  });
}

function workspaceLocationKind(
  workspace: CloudWorkspaceSummary,
): WorkspaceInventoryLocationKind {
  switch (workspace.sandboxType) {
    case "local":
      return "local";
    case "ssh":
      return "ssh";
    case "managed_shared":
      return "managed_shared";
    case "self_hosted":
      return "self_hosted";
    case "managed_personal":
      return "managed_personal";
    case undefined:
      return "cloud";
  }
}

function workspaceLocationLabel(workspace: CloudWorkspaceSummary): string {
  switch (workspace.sandboxType) {
    case "local":
      return "Local";
    case "ssh":
      return "SSH";
    case "managed_shared":
      return "Cloud";
    case "self_hosted":
      return "Self-hosted";
    case "managed_personal":
      return "Cloud";
    case undefined:
      return "Cloud";
  }
}

function workspaceScopeLabel(workspace: CloudWorkspaceSummary): string {
  if (
    workspace.visibility === "shared_unclaimed" ||
    workspace.visibility === "claimed" ||
    workspace.sandboxType === "managed_shared" ||
    workspace.sandboxType === "self_hosted"
  ) {
    return "Shared";
  }
  return "Personal";
}

function workspaceStatusKind(
  workspace: CloudWorkspaceSummary,
): WorkspaceInventoryStatusKind {
  if (
    workspace.status === "archived" ||
    workspace.visibility === "archived" ||
    workspace.exposureState === "revoked"
  ) {
    return "done";
  }
  if (
    workspace.status === "error" ||
    workspace.exposureState === "stale" ||
    workspace.actionBlockKind
  ) {
    return "blocked";
  }
  if (workspaceIsMaterializing(workspace)) {
    return "working";
  }
  return lastSessionStatusKind(workspace) ?? "waiting";
}

function workspaceStatusLabel(workspace: CloudWorkspaceSummary): string {
  if (workspace.visibility === "archived" || workspace.status === "archived") {
    return "Archived";
  }
  if (workspace.exposureState === "revoked") {
    return "Revoked";
  }
  if (workspace.status === "error") {
    return "Error";
  }
  if (workspace.actionBlockKind) {
    return "Blocked";
  }
  if (workspace.exposureState === "stale") {
    return "Stale";
  }
  if (workspace.exposureState === "paused") {
    return "Paused";
  }
  switch (workspace.status) {
    case "pending":
      return "Pending";
    case "materializing":
      return "Starting";
    case "needs_rematerialization":
      return "Needs refresh";
    case "ready":
      return lastSessionStatusLabel(workspace) ?? "Ready";
  }
}

function workspaceIsMaterializing(workspace: CloudWorkspaceSummary): boolean {
  return (
    workspace.status === "pending" ||
    workspace.status === "materializing" ||
    workspace.status === "needs_rematerialization"
  );
}

function lastSessionStatusKind(
  workspace: CloudWorkspaceSummary,
): WorkspaceInventoryStatusKind | null {
  switch (lastSessionStatus(workspace)) {
    case "review":
    case "ready_for_review":
      return "review";
    case "running":
    case "queued":
      return "working";
    case "ended":
      return "done";
    default:
      return null;
  }
}

function lastSessionStatusLabel(workspace: CloudWorkspaceSummary): string | null {
  switch (lastSessionStatus(workspace)) {
    case "review":
      return "Review";
    case "ready_for_review":
      return "Ready for review";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "idle":
      return "Idle";
    case "ended":
      return "Done";
    default:
      return null;
  }
}

function lastSessionStatus(workspace: CloudWorkspaceSummary): string {
  return normalizedStatusToken(workspace.lastSessionSummary?.status);
}

function workspaceOwnerLabel(workspace: CloudWorkspaceSummary): string {
  switch (workspaceOwnershipKind(workspace)) {
    case "unclaimed":
      return "Unclaimed";
    case "claimed":
      return "Claimed";
    case "archived":
      return "Archived";
    case "team":
      return "Team";
    case "mine":
      return "Mine";
  }
}

function workspaceOwnershipKind(
  workspace: CloudWorkspaceSummary,
): WorkspaceInventoryOwnershipKind {
  if (workspace.visibility === "shared_unclaimed") {
    return "unclaimed";
  }
  if (workspace.visibility === "claimed") {
    return "claimed";
  }
  if (workspace.visibility === "archived") {
    return "archived";
  }
  if (workspace.sandboxType === "managed_shared") {
    return "team";
  }
  return "mine";
}

function workspaceExposureLabel(
  exposureState: CloudWorkspaceSummary["exposureState"] | null,
): string | null {
  switch (exposureState) {
    case "live":
      return "Live";
    case "tracked":
      return "Tracked";
    case "paused":
      return "Paused";
    case "stale":
      return "Stale";
    case "revoked":
      return "Revoked";
    case "untracked":
    case null:
    case undefined:
      return null;
  }
}

function repoLabel(workspace: CloudWorkspaceSummary): string {
  return `${workspace.repo.owner}/${workspace.repo.name}`;
}

function workspaceBranchLabel(workspace: CloudWorkspaceSummary): string {
  return (
    nonEmptyText(workspace.repo.branch) ??
    nonEmptyText(workspace.repo.baseBranch) ??
    "main"
  );
}

function workspaceDisplayLabel(workspace: CloudWorkspaceSummary): string {
  return (
    nonEmptyText(workspace.displayName) ??
    nonEmptyText(workspace.repo.name) ??
    workspaceBranchLabel(workspace) ??
    repoLabel(workspace)
  );
}

function workspaceLastActivityAt(workspace: CloudWorkspaceSummary): string | null {
  return (
    workspace.lastSessionSummary?.lastEventAt ??
    workspace.lastActivityAt ??
    workspace.updatedAt ??
    workspace.createdAt ??
    null
  );
}

function dateSortValue(value: string | null | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function formatShortRelativeTime(value: string | null, now: number): string | null {
  const timestamp = dateSortValue(value);
  if (!timestamp) {
    return null;
  }
  const elapsedMs = now - timestamp;
  if (elapsedMs < 60_000) {
    return "now";
  }
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return `${elapsedDays}d`;
  }
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) {
    return `${elapsedMonths}mo`;
  }
  return `${Math.floor(elapsedMonths / 12)}y`;
}

function nonEmptyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedStatusToken(value: string | null | undefined): string {
  return nonEmptyText(value)?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
}
