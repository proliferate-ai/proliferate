import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";

export type RepositoryAvailability = "local" | "local_cloud" | "cloud";

export interface SettingsRepositoryEntry {
  sourceRoot: string;
  name: string;
  secondaryLabel: string | null;
  workspaceCount: number;
  repoRootId: string;
  localWorkspaceId: string | null;
  gitProvider: string | null;
  gitOwner: string | null;
  gitRepoName: string | null;
  cloudConfigured: boolean;
  availability: RepositoryAvailability;
}

export interface CloudSettingsRepositoryEntry extends SettingsRepositoryEntry {
  gitOwner: string;
  gitRepoName: string;
}

function resolveRepoSourceRoot(repoRoot: RepoRoot): string {
  return repoRoot.path.trim() || repoRoot.id;
}

function resolveRepoName(repoRoot: RepoRoot, sourceRoot: string): string {
  return repoRoot.displayName?.trim()
    || repoRoot.remoteRepoName?.trim()
    || sourceRoot.split("/").filter(Boolean).pop()
    || sourceRoot;
}

export function buildSettingsRepositoryEntries(
  workspaces: Workspace[],
  repoRoots: RepoRoot[] = [],
  cloudRepoConfigs: CloudRepoConfigSummary[] = [],
): SettingsRepositoryEntry[] {
  const workspacesByRepoRootId = new Map<string, Workspace[]>();
  for (const workspace of workspaces) {
    const repoRootId = workspace.repoRootId?.trim();
    if (!repoRootId || workspace.surface === "cowork") {
      continue;
    }
    const repoWorkspaces = workspacesByRepoRootId.get(repoRootId);
    if (repoWorkspaces) {
      repoWorkspaces.push(workspace);
    } else {
      workspacesByRepoRootId.set(repoRootId, [workspace]);
    }
  }

  const configuredCloudRepos = cloudRepoConfigs.filter((config) => config.configured);
  const configuredCloudKeys = new Set(
    configuredCloudRepos.map((config) => cloudRepositoryKey(config.gitOwner, config.gitRepoName)),
  );
  const localCloudKeys = new Set<string>();

  const localRepos = repoRoots.map((repoRoot) => {
    const repoWorkspaces = workspacesByRepoRootId.get(repoRoot.id) ?? [];
    const localWorkspace = repoWorkspaces.find((workspace) => workspace.kind === "local")
      ?? repoWorkspaces[0]
      ?? null;
    const sourceRoot = resolveRepoSourceRoot(repoRoot);
    const gitOwner = repoRoot.remoteOwner?.trim() ?? null;
    const gitRepoName = repoRoot.remoteRepoName?.trim() ?? null;
    const cloudKey = gitOwner && gitRepoName ? cloudRepositoryKey(gitOwner, gitRepoName) : null;
    const cloudConfigured = cloudKey ? configuredCloudKeys.has(cloudKey) : false;
    if (cloudKey) {
      localCloudKeys.add(cloudKey);
    }

    return {
      sourceRoot,
      name: resolveRepoName(repoRoot, sourceRoot),
      secondaryLabel: null,
      workspaceCount: repoWorkspaces.length,
      repoRootId: repoRoot.id,
      localWorkspaceId: localWorkspace?.id ?? null,
      gitProvider: repoRoot.remoteProvider?.trim() ?? null,
      gitOwner,
      gitRepoName,
      cloudConfigured,
      availability: cloudConfigured ? "local_cloud" : "local",
    } satisfies SettingsRepositoryEntry;
  });

  const cloudOnlyRepos = configuredCloudRepos.flatMap((config) => {
    const key = cloudRepositoryKey(config.gitOwner, config.gitRepoName);
    if (localCloudKeys.has(key)) {
      return [];
    }
    return [{
      sourceRoot: `cloud:${config.gitOwner}/${config.gitRepoName}`,
      name: config.gitRepoName,
      secondaryLabel: config.gitOwner,
      workspaceCount: 0,
      repoRootId: "",
      localWorkspaceId: null,
      gitProvider: "github",
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      cloudConfigured: true,
      availability: "cloud",
    } satisfies SettingsRepositoryEntry];
  });

  const repos = [...localRepos, ...cloudOnlyRepos].sort((a, b) => {
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
