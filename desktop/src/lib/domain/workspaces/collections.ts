import type { RepoRoot, Workspace } from "@anyharness/sdk";
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
    repoRootId: cloudWorkspaceGroupKey(workspace),
    path: `${workspace.repo.owner}/${workspace.repo.name}`,
    surface: "standard",
    sourceRepoRootPath: cloudWorkspaceGroupKey(workspace),
    gitProvider: workspace.repo.provider,
    gitOwner: workspace.repo.owner,
    gitRepoName: workspace.repo.name,
    originalBranch: workspace.repo.branch,
    currentBranch: workspace.repo.branch,
    displayName: workspace.displayName ?? null,
    executionSummary: null,
    createdAt: workspace.createdAt ?? "",
    updatedAt: workspace.updatedAt ?? "",
  };
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
    workspaces: mergeWorkspaceCollections(enrichedLocalWorkspaces, cloudWorkspaces),
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
