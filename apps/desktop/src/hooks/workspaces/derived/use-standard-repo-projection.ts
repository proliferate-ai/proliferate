import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useMemo } from "react";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { useCoworkStatus } from "#product/hooks/access/anyharness/cowork/use-cowork-status";
import { buildStandardRepoProjection } from "#product/lib/domain/workspaces/cloud/standard-projection";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";

const EMPTY_REPO_ROOTS: RepoRoot[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_CLOUD_WORKSPACES: CloudWorkspaceSummary[] = [];

export function useStandardRepoProjection() {
  const { data: workspaceCollections, isLoading: workspacesLoading } = useWorkspaces();
  const { status: coworkStatus, isLoading: coworkLoading } = useCoworkStatus();
  const coworkRootRepoRootId = coworkStatus?.root?.repoRootId ?? null;

  const projection = useMemo(() => buildStandardRepoProjection({
    repoRoots: workspaceCollections?.repoRoots ?? EMPTY_REPO_ROOTS,
    localWorkspaces: workspaceCollections?.localWorkspaces ?? EMPTY_WORKSPACES,
    cloudWorkspaces: workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES,
    coworkRootRepoRootId,
  }), [coworkRootRepoRootId, workspaceCollections]);

  return {
    ...projection,
    isLoading: workspacesLoading || coworkLoading,
  };
}
