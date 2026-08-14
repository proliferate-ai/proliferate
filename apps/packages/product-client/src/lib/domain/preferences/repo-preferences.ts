export interface RepoConfig {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
  archiveScript: string;
  rerunSetupOnUnarchive: boolean;
}

export type PersistedRepoConfigInput = Record<string, {
  defaultBranch?: string | null;
  setupScript?: string;
  runCommand?: string;
  archiveScript?: string;
  rerunSetupOnUnarchive?: boolean;
}>;

export const DEFAULT_REPO_CONFIG: RepoConfig = {
  defaultBranch: null,
  setupScript: "",
  runCommand: "",
  archiveScript: "",
  rerunSetupOnUnarchive: true,
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
    archiveScript:
      config.archiveScript === undefined
        ? current.archiveScript
        : config.archiveScript,
    rerunSetupOnUnarchive:
      config.rerunSetupOnUnarchive === undefined
        ? current.rerunSetupOnUnarchive
        : config.rerunSetupOnUnarchive,
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
