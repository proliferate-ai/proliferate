import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";

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

function buildRepresentativeWorkspaceIds(
  workspaces: Workspace[],
): Map<string, string> {
  const representatives = new Map<string, Workspace>();

  for (const workspace of workspaces) {
    const key = workspace.repoRootId?.trim();
    if (!key) {
      continue;
    }

    const current = representatives.get(key);
    if (!current || (workspace.kind === "local" && current.kind !== "local")) {
      representatives.set(key, workspace);
    }
  }

  return new Map(
    Array.from(representatives.entries()).map(([repoRootId, workspace]) => [
      repoRootId,
      workspace.id,
    ]),
  );
}

function enrichLocalWorkspace(
  workspace: Workspace,
  repoRoot: RepoRoot | null,
  representativeWorkspaceId: string | null,
): Workspace {
  return {
    ...workspace,
    sourceRepoRootPath: repoRoot?.path ?? workspace.sourceRepoRootPath ?? workspace.path,
    sourceWorkspaceId: representativeWorkspaceId,
    gitProvider: repoRoot?.remoteProvider ?? workspace.gitProvider ?? null,
    gitOwner: repoRoot?.remoteOwner ?? workspace.gitOwner ?? null,
    gitRepoName: repoRoot?.remoteRepoName ?? workspace.gitRepoName ?? null,
  };
}

function enrichLocalWorkspaces(
  localWorkspaces: Workspace[],
  repoRoots: RepoRoot[],
): Workspace[] {
  const repoRootsById = new Map(repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const representativeWorkspaceIds = buildRepresentativeWorkspaceIds(localWorkspaces);

  return localWorkspaces.map((workspace) =>
    enrichLocalWorkspace(
      workspace,
      workspace.repoRootId ? repoRootsById.get(workspace.repoRootId) ?? null : null,
      workspace.repoRootId
        ? representativeWorkspaceIds.get(workspace.repoRootId) ?? workspace.id
        : workspace.id,
    ),
  );
}

export function localWorkspaceGroupKey(workspace: Workspace): string {
  if (workspace.gitProvider && workspace.gitOwner && workspace.gitRepoName) {
    return `${workspace.gitProvider}:${workspace.gitOwner}:${workspace.gitRepoName}`;
  }

  return workspace.sourceRepoRootPath?.trim()
    || workspace.repoRootId?.trim()
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
}

export function buildWorkspaceCollections(
  localWorkspaces: Workspace[],
  repoRoots: RepoRoot[] = [],
  cloudWorkspaces: CloudWorkspaceSummary[] = [],
): WorkspaceCollections {
  const enrichedLocalWorkspaces = sortWorkspacesByUpdatedAtDesc(
    enrichLocalWorkspaces(localWorkspaces, repoRoots),
  );

  return {
    localWorkspaces: enrichedLocalWorkspaces,
    repoRoots,
    cloudWorkspaces,
    workspaces: enrichedLocalWorkspaces,
  };
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
    ...collections.localWorkspaces.filter((existing) => existing.id !== workspace.id),
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
    collections.localWorkspaces,
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
    collections.localWorkspaces,
    [
      repoRoot,
      ...collections.repoRoots.filter((existing) => existing.id !== repoRoot.id),
    ],
    collections.cloudWorkspaces,
  );
}
