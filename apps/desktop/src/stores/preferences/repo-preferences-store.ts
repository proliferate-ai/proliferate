import { create } from "zustand";
import {
  DEFAULT_REPO_CONFIG,
  normalizeRepoConfig,
  type RepoConfig,
} from "@/lib/domain/preferences/repo-preferences";

export interface RepoPreferencesState {
  _hydrated: boolean;
  repoConfigs: Record<string, RepoConfig>;
  setRepoConfig: (sourceRoot: string, patch: Partial<RepoConfig>) => void;
  getRepoConfig: (sourceRoot: string) => RepoConfig | undefined;
  hydrate: (repoConfigs: Record<string, RepoConfig>) => void;
}

export const useRepoPreferencesStore = create<RepoPreferencesState>((set, get) => ({
  _hydrated: false,
  repoConfigs: {},

  setRepoConfig: (sourceRoot, patch) => set((state) => ({
    repoConfigs: {
      ...state.repoConfigs,
      [sourceRoot]: normalizeRepoConfig(
        patch,
        state.repoConfigs[sourceRoot] ?? DEFAULT_REPO_CONFIG,
      ),
    },
  })),

  getRepoConfig: (sourceRoot) => get().repoConfigs[sourceRoot],
  hydrate: (repoConfigs) => set({
    repoConfigs,
    _hydrated: true,
  }),
}));
