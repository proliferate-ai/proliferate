import { create } from "zustand";
import {
  USER_PREFERENCE_DEFAULTS,
  type UserPreferences,
} from "@/lib/domain/preferences/user/model";
import type { PersistedUserPreferencesMetadata } from "@/lib/domain/preferences/persisted-metadata";

interface UserPreferencesState extends UserPreferences {
  _hydrated: boolean;
  _persistedMetadata: PersistedUserPreferencesMetadata;
  set: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  setMultiple: (partial: Partial<UserPreferences>) => void;
  setPersistedMetadata: (metadata: PersistedUserPreferencesMetadata) => void;
  hydrate: (loaded: {
    preferences: UserPreferences;
    persistedMetadata: PersistedUserPreferencesMetadata;
  }) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>((set) => ({
  ...USER_PREFERENCE_DEFAULTS,
  _hydrated: false,
  _persistedMetadata: {},

  set: (key, value) => set({ [key]: value } as Partial<UserPreferencesState>),
  setMultiple: (partial) => set(partial as Partial<UserPreferencesState>),
  setPersistedMetadata: (_persistedMetadata) => set({ _persistedMetadata }),
  hydrate: ({ preferences, persistedMetadata }) => set({
    ...preferences,
    _persistedMetadata: persistedMetadata,
    _hydrated: true,
  }),
}));
