import type { RepoRoot, Workspace } from "@anyharness/sdk";
import {
  formatRelativeTime,
  workspaceDisplayName,
} from "#product/lib/domain/workspaces/display/workspace-display";

/**
 * Pure presentation rules for the Archived workspaces page: sort
 * comparators, the search predicate, and the meta-line builder. No React, no
 * stores, no access helpers — `lib/domain/**` holds app-local product rules
 * only.
 */
export type ArchivedWorkspaceSort = "archived" | "created" | "alpha";

export const ARCHIVED_WORKSPACE_SORT_OPTIONS: readonly {
  id: ArchivedWorkspaceSort;
  label: string;
}[] = [
  { id: "archived", label: "Recently archived" },
  { id: "created", label: "Recently created" },
  { id: "alpha", label: "Name" },
];

/**
 * The repo label for an archived row. Resolved through `repoRoots` (the
 * repo root's own display name or path basename) rather than the
 * workspace's own path, because a worktree workspace's path is its own
 * worktree directory, not the repo it belongs to.
 */
export function resolveArchivedWorkspaceRepoName(
  workspace: Workspace,
  repoRoots: readonly RepoRoot[],
): string {
  const repoRoot = repoRoots.find((candidate) => candidate.id === workspace.repoRootId);
  const source = repoRoot?.displayName?.trim() || repoRoot?.path || workspace.path;
  return source.split("/").filter(Boolean).pop() ?? source;
}

/**
 * "{repo} · Archived {date}", or "{repo} · Created {date}" when the sort is
 * by created time — the meta line reads whichever timestamp the list is
 * currently ordered by.
 */
export function archivedWorkspaceMetaLine(
  workspace: Workspace,
  repoRoots: readonly RepoRoot[],
  sort: ArchivedWorkspaceSort,
): string {
  const repoName = resolveArchivedWorkspaceRepoName(workspace, repoRoots);
  if (sort === "created") {
    return `${repoName} · Created ${formatRelativeTime(workspace.createdAt)}`;
  }
  const archivedAt = workspace.archivedAt ?? workspace.updatedAt;
  return `${repoName} · Archived ${formatRelativeTime(archivedAt)}`;
}

function archivedTimestamp(workspace: Workspace): number {
  const value = workspace.archivedAt ?? workspace.updatedAt;
  return new Date(value).getTime();
}

function createdTimestamp(workspace: Workspace): number {
  return new Date(workspace.createdAt).getTime();
}

export function sortArchivedWorkspaces(
  workspaces: readonly Workspace[],
  sort: ArchivedWorkspaceSort,
): Workspace[] {
  const sorted = [...workspaces];
  switch (sort) {
    case "created":
      sorted.sort((a, b) => createdTimestamp(b) - createdTimestamp(a));
      break;
    case "alpha":
      sorted.sort((a, b) =>
        workspaceDisplayName(a).localeCompare(workspaceDisplayName(b), undefined, {
          sensitivity: "base",
        }));
      break;
    case "archived":
    default:
      sorted.sort((a, b) => archivedTimestamp(b) - archivedTimestamp(a));
      break;
  }
  return sorted;
}

/** The search predicate: matches on title or repo name, case-insensitively. */
export function matchesArchivedWorkspaceSearch(
  workspace: Workspace,
  repoRoots: readonly RepoRoot[],
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }
  const title = workspaceDisplayName(workspace).toLowerCase();
  const repoName = resolveArchivedWorkspaceRepoName(workspace, repoRoots).toLowerCase();
  return title.includes(trimmed) || repoName.includes(trimmed);
}

export function filterAndSortArchivedWorkspaces(
  workspaces: readonly Workspace[],
  repoRoots: readonly RepoRoot[],
  search: string,
  sort: ArchivedWorkspaceSort,
): Workspace[] {
  const matching = workspaces.filter((workspace) =>
    matchesArchivedWorkspaceSearch(workspace, repoRoots, search));
  return sortArchivedWorkspaces(matching, sort);
}
