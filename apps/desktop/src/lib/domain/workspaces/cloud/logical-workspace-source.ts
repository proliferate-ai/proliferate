import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  workspaceCurrentBranchName,
} from "@/lib/domain/workspaces/creation/branch-naming";
import {
  buildPathLogicalWorkspaceId,
  buildRemoteLogicalWorkspaceId,
  buildRepoRootLogicalWorkspaceId,
  normalizeLogicalWorkspaceBranchKey,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";

export function workspaceBranchKey(workspace: Workspace): string {
  const originalBranch = workspace.originalBranch?.trim();
  if (originalBranch) {
    return normalizeLogicalWorkspaceBranchKey(originalBranch);
  }

  return normalizeLogicalWorkspaceBranchKey(workspaceCurrentBranchName(workspace));
}

export function cloudBranchKey(workspace: CloudWorkspaceSummary): string {
  return normalizeLogicalWorkspaceBranchKey(workspace.repo.branch);
}

export function remoteRepoKey(
  provider: string | null | undefined,
  owner: string | null | undefined,
  repoName: string | null | undefined,
): string | null {
  if (!provider || !owner || !repoName) {
    return null;
  }

  return `${provider.trim()}:${owner.trim()}:${repoName.trim()}`;
}

export function resolveLocalWorkspaceRepoRoot(
  workspace: Workspace,
  repoRootsById: Map<string, RepoRoot>,
  _repoRootsByRemoteKey: Map<string, RepoRoot>,
): RepoRoot | null {
  if (workspace.repoRootId) {
    const repoRoot = repoRootsById.get(workspace.repoRootId);
    if (repoRoot) {
      return repoRoot;
    }
  }

  return null;
}

export function buildBaseLogicalWorkspaceIdForLocalWorkspace(
  workspace: Workspace,
  repoRoot: RepoRoot | null,
): string {
  if (repoRoot?.remoteProvider && repoRoot.remoteOwner && repoRoot.remoteRepoName) {
    return buildRemoteLogicalWorkspaceId(
      repoRoot.remoteProvider,
      repoRoot.remoteOwner,
      repoRoot.remoteRepoName,
      workspaceBranchKey(workspace),
    );
  }

  if (workspace.repoRootId) {
    return buildRepoRootLogicalWorkspaceId(workspace.repoRootId, workspaceBranchKey(workspace));
  }

  return buildPathLogicalWorkspaceId(
    workspace.path,
    workspaceBranchKey(workspace),
  );
}

export function compareLocalWorkspaceCanonicalOrder(
  left: Workspace,
  right: Workspace,
): number {
  const byCreatedAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (byCreatedAt !== 0) {
    return byCreatedAt;
  }
  return left.id.localeCompare(right.id);
}

export function buildLogicalWorkspaceIdForCloudWorkspace(
  workspace: CloudWorkspaceSummary,
): string {
  return buildRemoteLogicalWorkspaceId(
    workspace.repo.provider,
    workspace.repo.owner,
    workspace.repo.name,
    cloudBranchKey(workspace),
  );
}
