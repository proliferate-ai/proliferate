import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { cloudWorkspaceSyntheticId } from "./cloud-ids";

function sortWorkspacesByUpdatedAtDesc<T extends Pick<Workspace, "updatedAt">>(workspaces: T[]): T[] {
  return [...workspaces].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function cloudWorkspaceGroupKey(
  workspace: Pick<CloudWorkspaceSummary, "repo">,
): string {
  return `${workspace.repo.provider}:${workspace.repo.owner}:${workspace.repo.name}`;
}

function toSyntheticCloudWorkspace(workspace: CloudWorkspaceSummary): Workspace {
  return {
    id: cloudWorkspaceSyntheticId(workspace.id),
    kind: "repo",
    surfaceKind: "code",
    path: `${workspace.repo.owner}/${workspace.repo.name}`,
    sourceRepoRootPath: cloudWorkspaceGroupKey(workspace),
    gitProvider: workspace.repo.provider,
    gitOwner: workspace.repo.owner,
    gitRepoName: workspace.repo.name,
    originalBranch: workspace.repo.branch,
    currentBranch: workspace.repo.branch,
    defaultSessionId: null,
    createdAt: workspace.createdAt ?? "",
    updatedAt: workspace.updatedAt ?? "",
  };
}

export function localWorkspaceGroupKey(workspace: Workspace): string {
  if (workspace.gitProvider && workspace.gitOwner && workspace.gitRepoName) {
    return `${workspace.gitProvider}:${workspace.gitOwner}:${workspace.gitRepoName}`;
  }

  return workspace.sourceRepoRootPath;
}

export function workspaceFileTreeStateKey(workspace: Workspace): string {
  return localWorkspaceGroupKey(workspace);
}

export function mergeWorkspaceCollections(
  localWorkspaces: Workspace[],
  cloudWorkspaces: CloudWorkspaceSummary[],
): Workspace[] {
  const merged = [
    ...localWorkspaces,
    ...cloudWorkspaces.map(toSyntheticCloudWorkspace),
  ];

  return sortWorkspacesByUpdatedAtDesc(merged);
}

export interface WorkspaceCollections {
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  workspaces: Workspace[];
}

export function buildWorkspaceCollections(
  localWorkspaces: Workspace[],
  cloudWorkspaces: CloudWorkspaceSummary[],
): WorkspaceCollections {
  return {
    localWorkspaces,
    cloudWorkspaces,
    workspaces: mergeWorkspaceCollections(localWorkspaces, cloudWorkspaces),
  };
}

export function upsertLocalWorkspaceCollections(
  collections: WorkspaceCollections | undefined,
  workspace: Workspace,
): WorkspaceCollections | undefined {
  if (!collections) {
    return collections;
  }

  const localWorkspaces = sortWorkspacesByUpdatedAtDesc([
    workspace,
    ...collections.localWorkspaces.filter((existing) => existing.id !== workspace.id),
  ]);

  return buildWorkspaceCollections(localWorkspaces, collections.cloudWorkspaces);
}
