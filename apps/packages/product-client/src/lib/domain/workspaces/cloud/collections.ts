import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { cullCloudWorkspaceRows } from "#product/lib/domain/workspaces/cloud/cloud-culling";
import { shouldPollCloudWorkspaceForUpdates } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";

function sortWorkspacesByUpdatedAtDesc<T extends Pick<Workspace, "updatedAt">>(workspaces: T[]): T[] {
  return [...workspaces].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function cloudWorkspaceGroupKey(
  workspace: {
    repo: Pick<NonNullable<CloudWorkspaceSummary["repo"]>, "provider" | "owner" | "name"> | null;
  },
): string {
  // Scratch workspaces have no repository backing; group them together.
  if (!workspace.repo) {
    return "scratch";
  }
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
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  workspaces: Workspace[];
  allWorkspaces: Workspace[];
}

export function buildWorkspaceCollections(
  localWorkspaces: Workspace[],
  repoRoots: RepoRoot[] = [],
  cloudWorkspaces: CloudWorkspaceSummary[] = [],
): WorkspaceCollections {
  const sortedLocalWorkspaces = sortWorkspacesByUpdatedAtDesc(localWorkspaces);
  // Positive filter, not `!== "archived"`: nothing lists archived workspaces
  // until the archived settings page arrives, so an absorbed row must stay out
  // of the sidebar the moment the lifecycle migration runs.
  const activeLocalWorkspaces = sortedLocalWorkspaces.filter(
    (workspace) => workspace.lifecycleState === "active",
  );

  return {
    localWorkspaces: activeLocalWorkspaces,
    repoRoots,
    // Cloud culling (PRO-10, FR-2): existing cloud workspace rows are removed
    // once, here, at the single data-source seam so no downstream list can
    // resurrect a cloud surface from stale rows (FM1).
    cloudWorkspaces: cullCloudWorkspaceRows(cloudWorkspaces),
    workspaces: activeLocalWorkspaces,
    allWorkspaces: sortedLocalWorkspaces,
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
