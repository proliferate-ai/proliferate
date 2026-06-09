import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export interface StandardRepoProjection {
  repoRoots: RepoRoot[];
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
}

export function buildStandardRepoProjection(args: {
  repoRoots: RepoRoot[];
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  coworkRootRepoRootId?: string | null;
}): StandardRepoProjection {
  const coworkRootRepoRootId = args.coworkRootRepoRootId?.trim() || null;

  return {
    repoRoots: args.repoRoots.filter((repoRoot) => repoRoot.id !== coworkRootRepoRootId),
    localWorkspaces: args.localWorkspaces.filter((workspace) =>
      workspace.surface !== "cowork"
    ),
    cloudWorkspaces: args.cloudWorkspaces,
  };
}
