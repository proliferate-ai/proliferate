import type {
  CloudWorkspaceBackingKind as CloudSdkWorkspaceBackingKind,
  CloudWorkspaceSummary,
  RepoRef,
} from "@proliferate/cloud-sdk";

export type CloudWorkspaceBackingKind = CloudSdkWorkspaceBackingKind;

/**
 * Central placement/display derivation for the placement-neutral cloud
 * workspace identity. A repository worktree carries real repository metadata; a
 * scratch workspace (managed Workflow run) has no repository backing, so its
 * `repo` is `null` and repo-only actions must not be offered for it.
 *
 * Consumers must route every repository-only read through `workspaceRepoRef`
 * (or an explicit `isRepositoryWorktree` guard) rather than dereferencing
 * `workspace.repo` directly, so scratch placement never fabricates repository
 * data.
 */

type WorkspaceKindInput = Pick<CloudWorkspaceSummary, "workspaceKind">;
type WorkspaceRepoInput = Pick<CloudWorkspaceSummary, "workspaceKind" | "repo">;

/**
 * The backing kind of a workspace. Absent (older servers that predate the
 * migration) is treated as `repositoryWorktree`; only an explicit `scratch`
 * value is scratch.
 */
export function workspaceBackingKind(workspace: WorkspaceKindInput): CloudWorkspaceBackingKind {
  return workspace.workspaceKind === "scratch" ? "scratch" : "repositoryWorktree";
}

/** True only for repository worktrees — the sole placement with repo metadata. */
export function isRepositoryWorktree(workspace: WorkspaceKindInput): boolean {
  return workspaceBackingKind(workspace) === "repositoryWorktree";
}

/** True for scratch (repository-less) workspaces. */
export function isScratchWorkspace(workspace: WorkspaceKindInput): boolean {
  return workspaceBackingKind(workspace) === "scratch";
}

/**
 * The repository reference for a workspace, or `null` when it has no repository
 * backing. This is the one guard repo-only consumers must use before reading
 * owner/name/branch.
 */
export function workspaceRepoRef(workspace: WorkspaceRepoInput): RepoRef | null {
  return isRepositoryWorktree(workspace) ? (workspace.repo ?? null) : null;
}

/** `owner/name` label, or `null` for scratch workspaces. */
export function workspaceRepoLabel(workspace: WorkspaceRepoInput): string | null {
  const repo = workspaceRepoRef(workspace);
  return repo ? `${repo.owner}/${repo.name}` : null;
}

/** Branch label, defaulting to `main` (scratch workspaces are always `main`). */
export function workspaceBranchLabel(workspace: WorkspaceRepoInput): string {
  const repo = workspaceRepoRef(workspace);
  return nonEmpty(repo?.branch) ?? nonEmpty(repo?.baseBranch) ?? "main";
}

/** Best display title, never dereferencing repo data for scratch placement. */
export function workspaceDisplayTitle(
  workspace: WorkspaceRepoInput & Pick<CloudWorkspaceSummary, "displayName">,
): string {
  return (
    nonEmpty(workspace.displayName) ??
    nonEmpty(workspaceRepoRef(workspace)?.name) ??
    workspaceBranchLabel(workspace)
  );
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
