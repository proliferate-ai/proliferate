import { create } from "zustand";
import {
  DEFAULT_REPO_CONFIG,
  normalizeRepoConfig,
  type RepoConfig,
} from "@/lib/domain/preferences/repo-preferences";

export interface RepoPreferencesState {
  _hydrated: boolean;
  _persistenceRevision: number;
  repoConfigs: Record<string, RepoConfig>;
  setRepoConfig: (sourceRoot: string, patch: Partial<RepoConfig>) => void;
  getRepoConfig: (sourceRoot: string) => RepoConfig | undefined;
  hydrate: (repoConfigs: Record<string, RepoConfig>) => void;
}

export const useRepoPreferencesStore = create<RepoPreferencesState>((set, get) => ({
  _hydrated: false,
  _persistenceRevision: 0,
  repoConfigs: {},

  setRepoConfig: (sourceRoot, patch) => set((state) => ({
    _persistenceRevision: state._persistenceRevision + 1,
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
