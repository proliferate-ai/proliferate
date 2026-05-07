import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/access/cloud/client";
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
  if (!ctx?.repoWs || ctx.repoWs.gitProvider !== "github" || !ctx.repoWs.gitOwner || !ctx.repoWs.gitRepoName) {
    return null;
  }

  return {
    gitOwner: ctx.repoWs.gitOwner,
    gitRepoName: ctx.repoWs.gitRepoName,
  };
}
