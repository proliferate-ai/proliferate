import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud-workspace-creation";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/collections";

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function findRepoRootForWorkspace(
  workspace: Workspace,
  repoRoots: readonly RepoRoot[],
): RepoRoot | null {
  const repoRootId = nonEmpty(workspace.repoRootId);
  if (repoRootId) {
    const byId = repoRoots.find((repoRoot) => repoRoot.id === repoRootId);
    if (byId) {
      return byId;
    }
  }

  const provider = nonEmpty(workspace.gitProvider);
  const owner = nonEmpty(workspace.gitOwner);
  const repoName = nonEmpty(workspace.gitRepoName);
  if (!provider || !owner || !repoName) {
    return null;
  }

  return repoRoots.find((repoRoot) =>
    repoRoot.remoteProvider === provider
    && repoRoot.remoteOwner === owner
    && repoRoot.remoteRepoName === repoName
  ) ?? null;
}

export function sidebarRepoGroupKeyForWorkspace(
  workspace: Workspace,
  repoRoots: readonly RepoRoot[],
): string {
  const repoRoot = findRepoRootForWorkspace(workspace, repoRoots);
  return nonEmpty(repoRoot?.path)
    ?? nonEmpty(workspace.sourceRepoRootPath)
    ?? nonEmpty(workspace.repoRootId)
    ?? nonEmpty(workspace.path)
    ?? localWorkspaceGroupKey(workspace);
}

export function sidebarRepoGroupKeyForCloudTarget(
  target: CloudWorkspaceRepoTarget,
  repoRoots: readonly RepoRoot[],
): string {
  const repoRoot = repoRoots.find((candidate) =>
    candidate.remoteProvider === "github"
    && candidate.remoteOwner === target.gitOwner
    && candidate.remoteRepoName === target.gitRepoName
  );

  return nonEmpty(repoRoot?.path)
    ?? `github:${target.gitOwner}:${target.gitRepoName}`;
}
