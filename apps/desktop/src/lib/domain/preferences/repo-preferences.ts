export interface RepoConfig {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
  gitPublishInstructions: string;
}

export type PersistedRepoConfigInput = Record<string, {
  defaultBranch?: string | null;
  setupScript?: string;
  runCommand?: string;
  gitPublishInstructions?: string;
}>;

export const DEFAULT_REPO_CONFIG: RepoConfig = {
  defaultBranch: null,
  setupScript: "",
  runCommand: "",
  gitPublishInstructions: "",
};

export function normalizeRepoConfig(
  config: Partial<RepoConfig>,
  current: RepoConfig = DEFAULT_REPO_CONFIG,
): RepoConfig {
  return {
    defaultBranch:
      config.defaultBranch === undefined
        ? current.defaultBranch
        : config.defaultBranch?.trim()
          ? config.defaultBranch.trim()
          : null,
    setupScript:
      config.setupScript === undefined
        ? current.setupScript
        : config.setupScript,
    runCommand:
      config.runCommand === undefined
        ? current.runCommand
        : config.runCommand,
    gitPublishInstructions:
      config.gitPublishInstructions === undefined
        ? current.gitPublishInstructions
        : config.gitPublishInstructions,
  };
}

export function normalizeRepoConfigs(
  repoConfigs: PersistedRepoConfigInput,
): Record<string, RepoConfig> {
  return Object.fromEntries(
    Object.entries(repoConfigs).map(([sourceRoot, config]) => [
      sourceRoot,
      normalizeRepoConfig(config),
    ]),
  );
}
