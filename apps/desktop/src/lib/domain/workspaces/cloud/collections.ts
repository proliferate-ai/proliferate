import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { shouldPollCloudWorkspaceForUpdates } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";

function sortWorkspacesByUpdatedAtDesc<T extends Pick<Workspace, "updatedAt">>(workspaces: T[]): T[] {
  return [...workspaces].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function cloudWorkspaceGroupKey(
  workspace: { repo: Pick<CloudWorkspaceSummary["repo"], "provider" | "owner" | "name"> },
): string {
  return `${workspace.repo.provider}:${workspace.repo.owner}:${workspace.repo.name}`;
}

export function repoRootGroupKey(
  repoRoot: Pick<
    RepoRoot,
    "path" | "remoteProvider" | "remoteOwner" | "remoteRepoName"
  >,
): string {
  if (repoRoot.remoteProvider && repoRoot.remoteOwner && repoRoot.remoteRepoName) {
    return `${repoRoot.remoteProvider}:${repoRoot.remoteOwner}:${repoRoot.remoteRepoName}`;
  }

  return repoRoot.path.trim();
}

export function localWorkspaceGroupKey(workspace: Workspace): string {
  return workspace.repoRootId?.trim()
    || workspace.path;
}

export function workspaceFileTreeStateKey(workspace: Workspace): string {
  return localWorkspaceGroupKey(workspace);
}

export interface WorkspaceCollections {
  localWorkspaces: Workspace[];
  retiredLocalWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  workspaces: Workspace[];
  allWorkspaces: Workspace[];
  cleanupAttentionWorkspaces: Workspace[];
}

export function buildWorkspaceCollections(
  localWorkspaces: Workspace[],
  repoRoots: RepoRoot[] = [],
  cloudWorkspaces: CloudWorkspaceSummary[] = [],
): WorkspaceCollections {
  const sortedLocalWorkspaces = sortWorkspacesByUpdatedAtDesc(localWorkspaces);
  const activeLocalWorkspaces = sortedLocalWorkspaces.filter(
    (workspace) => workspace.lifecycleState !== "retired",
  );
  const retiredLocalWorkspaces = sortedLocalWorkspaces.filter(
    (workspace) => workspace.lifecycleState === "retired",
  );
  const cleanupAttentionWorkspaces = retiredLocalWorkspaces.filter(
    (workspace) => workspace.cleanupState === "pending" || workspace.cleanupState === "failed",
  );

  return {
    localWorkspaces: activeLocalWorkspaces,
    retiredLocalWorkspaces,
    repoRoots,
    cloudWorkspaces,
    workspaces: activeLocalWorkspaces,
    allWorkspaces: sortedLocalWorkspaces,
    cleanupAttentionWorkspaces,
  };
}

export function workspaceCollectionsNeedActivityRefresh(
  collections: WorkspaceCollections | undefined,
): boolean {
  if (!collections) {
    return false;
  }

  const hasLocalActivity = collections.localWorkspaces.some((workspace) => {
    const phase = workspace.executionSummary?.phase;
    return phase === "running";
  });
  if (hasLocalActivity) {
    return true;
  }

  return collections.cloudWorkspaces.some(shouldPollCloudWorkspaceForUpdates);
}

export function upsertLocalWorkspaceCollections(
  collections: WorkspaceCollections | undefined,
  workspace: Workspace,
  repoRoot?: RepoRoot | null,
): WorkspaceCollections | undefined {
  if (!collections) {
    return collections;
  }

  const repoRoots = repoRoot
    ? [
      repoRoot,
      ...collections.repoRoots.filter((existing) => existing.id !== repoRoot.id),
    ]
    : collections.repoRoots;

  const localWorkspaces = [
    workspace,
    ...collections.allWorkspaces.filter((existing) => existing.id !== workspace.id),
  ];

  return buildWorkspaceCollections(localWorkspaces, repoRoots, collections.cloudWorkspaces);
}

export function upsertCloudWorkspaceCollections(
  collections: WorkspaceCollections | undefined,
  workspace: CloudWorkspaceSummary,
): WorkspaceCollections | undefined {
  if (!collections) {
    return collections;
  }

  const cloudWorkspaces = [
    workspace,
    ...collections.cloudWorkspaces.filter((existing) => existing.id !== workspace.id),
  ];

  return buildWorkspaceCollections(
    collections.allWorkspaces,
    collections.repoRoots,
    cloudWorkspaces,
  );
}

export function upsertRepoRootCollections(
  collections: WorkspaceCollections | undefined,
  repoRoot: RepoRoot,
): WorkspaceCollections | undefined {
  if (!collections) {
    return collections;
  }

  return buildWorkspaceCollections(
    collections.allWorkspaces,
    [
      repoRoot,
      ...collections.repoRoots.filter((existing) => existing.id !== repoRoot.id),
    ],
    collections.cloudWorkspaces,
  );
}
