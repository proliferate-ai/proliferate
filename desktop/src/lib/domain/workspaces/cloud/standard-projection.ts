import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/access/cloud/client";

export interface StandardRepoProjection {
  repoRoots: RepoRoot[];
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
}

function isLegacyStructuralRepoWorkspace(workspace: Workspace): boolean {
  return (workspace as { kind: string }).kind === "repo";
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
      workspace.surface !== "cowork" && !isLegacyStructuralRepoWorkspace(workspace)
    ),
    cloudWorkspaces: args.cloudWorkspaces,
  };
}
