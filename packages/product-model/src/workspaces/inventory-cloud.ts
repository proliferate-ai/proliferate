import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type {
  WorkspaceInventoryItemView,
  WorkspaceInventoryLocationKind,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "./inventory";

type WorkspaceSourceModel = {
  kind: WorkspaceInventorySourceKind;
  label: string;
};

const AUTOMATION_BRANCH_PATTERN = /^automation\/.+-[a-f0-9]{12,16}$/iu;

export function cloudWorkspaceInventoryItem(
  workspace: CloudWorkspaceSummary,
  now: number,
): WorkspaceInventoryItemView {
  const sourceModel = workspaceSource(workspace);
  const sessionLabel =
    nonEmptyText(workspace.lastSessionSummary?.title) ??
    nonEmptyText(workspace.lastSessionSummary?.preview);

  return {
    id: workspace.id,
    title: workspaceDisplayLabel(workspace),
    repoLabel: repoLabel(workspace),
    branchLabel: workspaceBranchLabel(workspace),
    sourceKind: sourceModel.kind,
    sourceLabel: sourceModel.label,
    locationKind: workspaceLocationKind(workspace),
    locationLabel: workspaceLocationLabel(workspace),
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

function workspaceSource(workspace: CloudWorkspaceSummary): WorkspaceSourceModel {
  const entrypoint = nonEmptyText(workspace.origin?.entrypoint);
  const kind = nonEmptyText(workspace.origin?.kind);
  const creatorKind = nonEmptyText(workspace.creatorContext?.kind);
  const claimSourceKind = nonEmptyText(workspace.claimSourceKind);

  if (entrypoint === "slack" || claimSourceKind === "slack") {
    return source("slack", "Slack");
  }
  if (
    creatorKind === "automation" ||
    isLegacyAutomationWorkspace(workspace, kind, entrypoint) ||
    claimSourceKind === "automation"
  ) {
    return source("automation", "Automation");
  }
  if (entrypoint === "api" || kind === "api" || claimSourceKind === "api") {
    return source("api", "API");
  }
  if (
    kind === "human" ||
    kind === "cowork" ||
    entrypoint === "web" ||
    entrypoint === "desktop" ||
    entrypoint === "mobile" ||
    entrypoint === "cowork"
  ) {
    return source("chat", sourceEntrypointLabel(entrypoint));
  }
  if (kind === "system" || entrypoint === "cloud") {
    return source("system", "Cloud");
  }
  return source("other", "Other");
}

function source(
  kind: WorkspaceInventorySourceKind,
  label: string,
): WorkspaceSourceModel {
  return {
    kind,
    label,
  };
}

function isLegacyAutomationWorkspace(
  workspace: CloudWorkspaceSummary,
  kind: string | null,
  entrypoint: string | null,
): boolean {
  return (
    kind === "system" &&
    entrypoint === "cloud" &&
    AUTOMATION_BRANCH_PATTERN.test(workspaceBranchLabel(workspace))
  );
}

function sourceEntrypointLabel(entrypoint: string | null): string {
  switch (entrypoint) {
    case "desktop":
      return "Desktop";
    case "web":
      return "Web";
    case "mobile":
      return "Mobile";
    case "cloud":
      return "Cloud";
    case "cowork":
      return "Chat";
    case "local_runtime":
      return "Local runtime";
    case null:
      return "Chat";
    default:
      return formatSourceToken(entrypoint);
  }
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

function formatSourceToken(value: string): string {
  return (
    value
      .split(/[_\s-]+/u)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Other"
  );
}
