import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type {
  CloudWorkOwnerKind,
  CloudWorkStatusFilter,
  RecentWorkCloudAccessState,
  RecentWorkCommandability,
  RecentWorkOwnership,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
  RecentWorkState,
} from "./cloud-work-inventory-types";
import { workspaceHasPendingSessionInput } from "./cloud-work-status";

export function recentWorkSourceLabel(source: RecentWorkSourceKind): string {
  switch (source) {
    case "desktop_exposed":
      return "Desktop";
    case "cloud_sandbox":
      return "Cloud sandbox";
    case "web":
      return "Web";
    case "mobile":
      return "Mobile";
    case "personal_automation":
      return "Personal automation";
    case "team_automation":
      return "Team automation";
    case "slack":
      return "Slack";
    case "api":
      return "API";
    case "unknown":
      return "Unknown";
  }
}

export function recentWorkRuntimeLabel(runtimeLocation: RecentWorkRuntimeLocation): string {
  switch (runtimeLocation) {
    case "local_desktop":
      return "Local Desktop";
    case "cloud_sandbox":
      return "Cloud runtime";
    case "ssh_remote":
      return "SSH remote";
    case "offline":
      return "Offline";
    case "unknown":
      return "Unknown runtime";
  }
}

export function recentWorkCloudAccessLabel(state: RecentWorkCloudAccessState): string {
  switch (state) {
    case "enabled":
      return "Cloud access enabled";
    case "not_enabled":
      return "Cloud access off";
    case "unknown":
      return "Cloud access unknown";
  }
}

export function recentWorkCommandabilityLabel(commandability: RecentWorkCommandability): string {
  switch (commandability) {
    case "commandable":
      return "Ready for commands";
    case "not_commandable":
      return "Commands unavailable";
    case "stale":
      return "Runtime offline";
    case "unknown":
      return "Command status unknown";
  }
}

export function recentWorkOwnership(workspace: Pick<CloudWorkspaceSummary, "visibility" | "sandboxType">): RecentWorkOwnership {
  if (workspace.visibility === "shared_unclaimed") {
    return "unclaimed";
  }
  if (workspace.visibility === "claimed" || workspace.sandboxType === "managed_shared") {
    return "team";
  }
  if (workspace.visibility === "private") {
    return "mine";
  }
  return "unknown";
}

export function recentWorkOwnershipLabel(ownership: RecentWorkOwnership): string {
  switch (ownership) {
    case "mine":
      return "Mine";
    case "team":
      return "Team";
    case "unclaimed":
      return "Unclaimed";
    case "unknown":
      return "Unknown owner";
  }
}

export function workspaceState(workspace: CloudWorkspaceSummary): RecentWorkState {
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.actionBlockKind ||
    workspace.actionBlockReason ||
    workspace.exposureState === "stale" ||
    workspaceHasPendingSessionInput(workspace)
  ) {
    return "blocked";
  }
  if (
    workspace.workspaceStatus === "pending" ||
    workspace.workspaceStatus === "materializing" ||
    workspace.workspaceStatus === "needs_rematerialization"
  ) {
    return "pending";
  }
  if (workspace.workspaceStatus === "archived" || workspace.status === "archived") {
    return "done";
  }
  return "idle";
}

export function sessionState(status: string | null | undefined, workspace: CloudWorkspaceSummary): RecentWorkState {
  if (workspaceHasPendingSessionInput(workspace)) {
    return "blocked";
  }
  const normalized = status?.toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  switch (normalized) {
    case "running":
    case "queued":
      return "running";
    case "review":
    case "ready_for_review":
      return "review";
    case "ended":
    case "done":
    case "completed":
      return "done";
    case "error":
    case "failed":
      return "blocked";
    case "idle":
      return workspaceState(workspace) === "blocked" ? "blocked" : "idle";
    default:
      return workspaceState(workspace);
  }
}

export function recentWorkStateLabel(state: RecentWorkState): string {
  switch (state) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "review":
      return "Review";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "pending":
      return "Pending";
    case "unknown":
      return "Unknown";
  }
}

export function cloudWorkOwnerLabel(workspace: Pick<CloudWorkspaceSummary, "visibility">): string {
  switch (cloudWorkOwnerKind(workspace)) {
    case "private":
      return "Private";
    case "unclaimed":
      return "Unclaimed";
    case "claimed":
      return "Claimed";
    case "archived":
      return "Archived";
  }
}

export function cloudWorkOwnerKind(
  workspace: Pick<CloudWorkspaceSummary, "visibility">,
): CloudWorkOwnerKind {
  switch (workspace.visibility) {
    case "shared_unclaimed":
      return "unclaimed";
    case "claimed":
      return "claimed";
    case "archived":
      return "archived";
    case "private":
    default:
      return "private";
  }
}

export function cloudWorkRuntimeLabel(workspace: Pick<CloudWorkspaceSummary, "sandboxType" | "runtime">): string {
  if (workspace.sandboxType) {
    return workspace.sandboxType.replace(/_/g, " ");
  }
  return workspace.runtime?.status ?? "cloud";
}

export function statusRank(status: CloudWorkStatusFilter): number {
  switch (status) {
    case "blocked":
      return 0;
    case "running":
      return 1;
    case "active":
      return 2;
    case "ready":
      return 3;
    case "error":
      return 4;
    case "archived":
      return 5;
  }
}
