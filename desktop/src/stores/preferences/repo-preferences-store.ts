import { create } from "zustand";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

export interface RepoConfig {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

export interface RepoPreferencesState {
  _hydrated: boolean;
  repoConfigs: Record<string, RepoConfig>;
  setRepoConfig: (sourceRoot: string, patch: Partial<RepoConfig>) => void;
  getRepoConfig: (sourceRoot: string) => RepoConfig | undefined;
}

const REPO_PREFERENCES_KEY = "repo_preferences";
const DEFAULT_REPO_CONFIG: RepoConfig = {
  defaultBranch: null,
  setupScript: "",
  runCommand: "",
};

function normalizeRepoConfigs(
  repoConfigs: Record<string, {
    defaultBranch?: string | null;
    setupScript?: string;
    runCommand?: string;
  }>,
): Record<string, RepoConfig> {
  return Object.fromEntries(
    Object.entries(repoConfigs).map(([sourceRoot, config]) => [
      sourceRoot,
      {
        defaultBranch: config.defaultBranch?.trim() ? config.defaultBranch.trim() : null,
        setupScript: config.setupScript ?? "",
        runCommand: config.runCommand ?? "",
      },
    ]),
  );
}

async function readAll(): Promise<Record<string, RepoConfig>> {
  const persisted = await readPersistedValue<Record<string, RepoConfig>>(REPO_PREFERENCES_KEY);
  if (persisted) {
    return normalizeRepoConfigs(persisted);
  }

  const legacyRepoConfigs =
    await readPersistedValue<Record<string, {
      defaultBranch?: string | null;
      setupScript?: string;
      runCommand?: string;
    }>>("repoConfigs");
  return normalizeRepoConfigs(legacyRepoConfigs ?? {});
}

export const useRepoPreferencesStore = create<RepoPreferencesState>((set, get) => ({
  _hydrated: false,
  repoConfigs: {},

  setRepoConfig: (sourceRoot, patch) => {
    const current = get().repoConfigs[sourceRoot] ?? DEFAULT_REPO_CONFIG;
    const nextConfig: RepoConfig = {
      defaultBranch:
        patch.defaultBranch === undefined
          ? current.defaultBranch
          : patch.defaultBranch?.trim()
            ? patch.defaultBranch.trim()
            : null,
      setupScript:
        patch.setupScript === undefined
          ? current.setupScript
          : patch.setupScript,
      runCommand:
        patch.runCommand === undefined
          ? current.runCommand
          : patch.runCommand,
    };
    set({
      repoConfigs: {
        ...get().repoConfigs,
        [sourceRoot]: nextConfig,
      },
    });
  },

  getRepoConfig: (sourceRoot) => get().repoConfigs[sourceRoot],
}));

useRepoPreferencesStore.subscribe((state, prev) => {
  if (!state._hydrated || state.repoConfigs === prev.repoConfigs) {
    return;
  }
  void persistValue(REPO_PREFERENCES_KEY, state.repoConfigs);
});

export async function bootstrapRepoPreferences(): Promise<void> {
  const repoConfigs = await readAll();
  useRepoPreferencesStore.setState({
    repoConfigs,
    _hydrated: true,
  });
}
