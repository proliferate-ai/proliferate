import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import { isCloudWorkspaceId, parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { isStandardWorkspace } from "@/lib/domain/workspaces/display/usability";

export function getRepoForSelectedWorkspace(
  selectedWorkspaceId: string | null,
  workspaces: Workspace[],
) {
  if (!selectedWorkspaceId) {
    return null;
  }

  const selectedWs = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  if (!selectedWs || !isStandardWorkspace(selectedWs)) {
    return null;
  }

  const repoWs = workspaces
    .filter(
      (workspace) =>
        !isCloudWorkspaceId(workspace.id)
        && isStandardWorkspace(workspace)
        && localWorkspaceGroupKey(workspace) === localWorkspaceGroupKey(selectedWs),
    )
    .sort((a, b) => {
      if (a.kind === b.kind) {
        return a.id.localeCompare(b.id);
      }
      return a.kind === "local" ? -1 : 1;
    })[0] ?? null;

  return { selectedWs, repoWs };
}

export function getCloudRepoTargetForSelectedWorkspace(
  selectedWorkspaceId: string | null,
  workspaces: Workspace[],
  cloudWorkspaces: CloudWorkspaceSummary[],
  repoRoots: RepoRoot[],
): CloudWorkspaceRepoTarget | null {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  if (cloudWorkspaceId) {
    const cloudWorkspace = cloudWorkspaces.find((workspace) => workspace.id === cloudWorkspaceId);
    if (cloudWorkspace?.repo.provider !== "github") {
      return null;
    }

    return {
      gitOwner: cloudWorkspace.repo.owner,
      gitRepoName: cloudWorkspace.repo.name,
    };
  }

  const ctx = getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces);
  const repoRoot = ctx?.repoWs?.repoRootId
    ? repoRoots.find((candidate) => candidate.id === ctx.repoWs?.repoRootId) ?? null
    : null;
  if (repoRoot?.remoteProvider !== "github" || !repoRoot.remoteOwner || !repoRoot.remoteRepoName) {
    return null;
  }

  return {
    gitOwner: repoRoot.remoteOwner,
    gitRepoName: repoRoot.remoteRepoName,
  };
}
