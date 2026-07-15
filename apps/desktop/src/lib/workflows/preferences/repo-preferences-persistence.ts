import {
  normalizeRepoConfigs,
  type PersistedRepoConfigInput,
  type RepoConfig,
} from "@/lib/domain/preferences/repo-preferences";
import {
  readPersistedJsonValue,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const REPO_PREFERENCES_KEY = "repo_preferences";
const LEGACY_REPO_CONFIGS_KEY = "repoConfigs";

export async function loadRepoPreferences(
  context: ProductStorageContext,
): Promise<Record<string, RepoConfig>> {
  const persisted =
    await readPersistedJsonValue<PersistedRepoConfigInput>(context, REPO_PREFERENCES_KEY);
  if (persisted) {
    return normalizeRepoConfigs(persisted);
  }

  const legacyRepoConfigs =
    await readPersistedJsonValue<PersistedRepoConfigInput>(context, LEGACY_REPO_CONFIGS_KEY);
  return normalizeRepoConfigs(legacyRepoConfigs ?? {});
}

export async function persistRepoPreferences(
  context: ProductStorageContext,
  repoConfigs: Record<string, RepoConfig>,
): Promise<void> {
  await writePersistedJson(context, REPO_PREFERENCES_KEY, repoConfigs);
}
