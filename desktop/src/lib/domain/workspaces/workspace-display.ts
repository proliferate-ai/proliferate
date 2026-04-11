import type { Workspace } from "@anyharness/sdk";
import { humanizeBranchName, workspaceCurrentBranchName } from "@/lib/domain/workspaces/branch-naming";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";

export function formatRelativeTime(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (seconds < 60) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatSidebarRelativeTime(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (seconds < 60) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function workspaceBranchName(workspace: Workspace): string {
  return workspaceCurrentBranchName(workspace)
    ?? workspace.path.split("/").pop()
    ?? workspace.path;
}

export function workspaceBranchLabel(workspace: Workspace): string {
  const branchName = workspaceCurrentBranchName(workspace);
  if (!branchName) {
    return workspaceBranchName(workspace);
  }

  return humanizeBranchName(branchName);
}

export function workspaceDisplayName(workspace: Workspace): string {
  const override = workspace.displayName?.trim();
  if (override) {
    return override;
  }

  return workspaceDefaultDisplayName(workspace);
}

/**
 * The label we would show if no user override were set. Useful as the
 * placeholder/preview text in the rename UI so the user knows what clearing
 * the override will reveal.
 */
export function workspaceDefaultDisplayName(workspace: Workspace): string {
  if (workspace.kind === "worktree" || isCloudWorkspaceId(workspace.id)) {
    const branchName = workspaceCurrentBranchName(workspace);
    if (branchName) {
      return humanizeBranchName(branchName);
    }
  }

  return workspaceRepoName(workspace);
}

export function workspaceRepoName(workspace: Workspace): string {
  return workspace.gitRepoName
    ?? workspace.sourceRepoRootPath?.split("/").pop()
    ?? workspace.path.split("/").pop()
    ?? workspace.path;
}

export function formatCloudStatus(status: string | null | undefined): string | null {
  if (!status || status === "ready") return null;
  return status.replaceAll("_", " ");
}

export function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
