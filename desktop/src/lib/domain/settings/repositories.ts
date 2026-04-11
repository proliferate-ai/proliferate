import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/usability";

export interface SettingsRepositoryEntry {
  sourceRoot: string;
  name: string;
  secondaryLabel: string | null;
  workspaceCount: number;
  repoWorkspaceId: string;
  repoRootId: string | null;
  gitProvider: string | null;
  gitOwner: string | null;
  gitRepoName: string | null;
}

export interface CloudSettingsRepositoryEntry extends SettingsRepositoryEntry {
  gitOwner: string;
  gitRepoName: string;
}

function resolveRepoSourceRoot(workspace: Workspace): string {
  return workspace.sourceRepoRootPath?.trim()
    || workspace.path?.trim()
    || workspace.id;
}

function resolveRepoName(workspace: Workspace, sourceRoot: string): string {
  return workspace.gitRepoName?.trim()
    || sourceRoot.split("/").filter(Boolean).pop()
    || sourceRoot;
}

export function buildSettingsRepositoryEntries(
  workspaces: Workspace[],
  repoRoots: RepoRoot[] = [],
): SettingsRepositoryEntry[] {
  const repoRootsById = new Map(repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const entries = new Map<string, SettingsRepositoryEntry>();

  for (const workspace of workspaces) {
    if (workspace.surface === "cowork" || isStructuralRepoWorkspace(workspace)) {
      continue;
    }

    const repoRoot = workspace.repoRootId
      ? repoRootsById.get(workspace.repoRootId) ?? null
      : null;
    const sourceRoot = resolveRepoSourceRoot(workspace);
    const entryKey = workspace.repoRootId ?? sourceRoot;
    const existing = entries.get(entryKey);
    if (!existing) {
      entries.set(entryKey, {
        sourceRoot: repoRoot?.path ?? sourceRoot,
        name: repoRoot?.displayName?.trim()
          || resolveRepoName(workspace, repoRoot?.path ?? sourceRoot),
        secondaryLabel: null,
        workspaceCount: 1,
        repoWorkspaceId: workspace.sourceWorkspaceId ?? workspace.id,
        repoRootId: workspace.repoRootId ?? null,
        gitProvider:
          repoRoot?.remoteProvider?.trim()
          ?? workspace.gitProvider?.trim()
          ?? null,
        gitOwner:
          repoRoot?.remoteOwner?.trim()
          ?? workspace.gitOwner?.trim()
          ?? null,
        gitRepoName:
          repoRoot?.remoteRepoName?.trim()
          ?? workspace.gitRepoName?.trim()
          ?? null,
      });
      continue;
    }

    existing.workspaceCount += 1;
    if (workspace.kind === "local") {
      existing.repoWorkspaceId = workspace.id;
    }
    existing.gitProvider = existing.gitProvider
      ?? repoRoot?.remoteProvider?.trim()
      ?? workspace.gitProvider?.trim()
      ?? null;
    existing.gitOwner = existing.gitOwner
      ?? repoRoot?.remoteOwner?.trim()
      ?? workspace.gitOwner?.trim()
      ?? null;
    existing.gitRepoName = existing.gitRepoName
      ?? repoRoot?.remoteRepoName?.trim()
      ?? workspace.gitRepoName?.trim()
      ?? null;
  }

  const repos = Array.from(entries.values()).sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.sourceRoot.localeCompare(b.sourceRoot);
  });

  const nameCounts = new Map<string, number>();
  for (const repo of repos) {
    nameCounts.set(repo.name, (nameCounts.get(repo.name) ?? 0) + 1);
  }

  return repos.map((repo) => ({
    ...repo,
    secondaryLabel: (nameCounts.get(repo.name) ?? 0) > 1 ? repo.sourceRoot : null,
  }));
}

export function isCloudRepository(
  repository: SettingsRepositoryEntry | null | undefined,
): repository is CloudSettingsRepositoryEntry {
  return Boolean(repository?.gitOwner && repository.gitRepoName);
}

export function cloudRepositoryKey(gitOwner: string, gitRepoName: string): string {
  return `${gitOwner}::${gitRepoName}`;
}
