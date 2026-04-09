import type { Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/usability";

export interface SettingsRepositoryEntry {
  sourceRoot: string;
  name: string;
  secondaryLabel: string | null;
  workspaceCount: number;
  repoWorkspaceId: string;
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
): SettingsRepositoryEntry[] {
  const entries = new Map<string, SettingsRepositoryEntry>();

  for (const workspace of workspaces) {
    const sourceRoot = resolveRepoSourceRoot(workspace);
    const existing = entries.get(sourceRoot);
    if (!existing) {
      entries.set(sourceRoot, {
        sourceRoot,
        name: resolveRepoName(workspace, sourceRoot),
        secondaryLabel: null,
        workspaceCount: isStructuralRepoWorkspace(workspace) ? 0 : 1,
        repoWorkspaceId:
          workspace.kind === "repo"
            ? workspace.id
            : workspace.sourceWorkspaceId ?? workspace.id,
        gitProvider: workspace.gitProvider?.trim() ?? null,
        gitOwner: workspace.gitOwner?.trim() ?? null,
        gitRepoName: workspace.gitRepoName?.trim() ?? null,
      });
      continue;
    }

    if (!isStructuralRepoWorkspace(workspace)) {
      existing.workspaceCount += 1;
    }
    if (workspace.kind === "repo") {
      existing.repoWorkspaceId = workspace.id;
    }
    existing.gitProvider = existing.gitProvider ?? workspace.gitProvider?.trim() ?? null;
    existing.gitOwner = existing.gitOwner ?? workspace.gitOwner?.trim() ?? null;
    existing.gitRepoName = existing.gitRepoName ?? workspace.gitRepoName?.trim() ?? null;
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
