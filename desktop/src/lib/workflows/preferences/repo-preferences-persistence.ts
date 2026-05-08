import {
  normalizeRepoConfigs,
  type PersistedRepoConfigInput,
  type RepoConfig,
} from "@/lib/domain/preferences/repo-preferences";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";

const REPO_PREFERENCES_KEY = "repo_preferences";
const LEGACY_REPO_CONFIGS_KEY = "repoConfigs";

export async function loadRepoPreferences(): Promise<Record<string, RepoConfig>> {
  const persisted = await readPersistedValue<PersistedRepoConfigInput>(REPO_PREFERENCES_KEY);
  if (persisted) {
    return normalizeRepoConfigs(persisted);
  }

  const legacyRepoConfigs =
    await readPersistedValue<PersistedRepoConfigInput>(LEGACY_REPO_CONFIGS_KEY);
  return normalizeRepoConfigs(legacyRepoConfigs ?? {});
}

export async function persistRepoPreferences(
  repoConfigs: Record<string, RepoConfig>,
): Promise<void> {
  await persistValue(REPO_PREFERENCES_KEY, repoConfigs);
}
