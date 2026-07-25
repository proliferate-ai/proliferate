import {
  normalizeRepoConfigs,
  type PersistedRepoConfigInput,
  type RepoConfig,
} from "@/lib/domain/preferences/repo-preferences";
import {
  readProductStorageJson,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const REPO_PREFERENCES_KEY = "repo_preferences";
const LEGACY_REPO_CONFIGS_KEY = "repoConfigs";

export async function loadRepoPreferences(
  context: ProductStorageContext,
): Promise<Record<string, RepoConfig>> {
  const persisted = await readProductStorageJson<unknown>(
    context,
    REPO_PREFERENCES_KEY,
  );
  if (isPlainRecord(persisted)) {
    return normalizePersistedRepoConfigs(persisted);
  }

  const legacyRepoConfigs =
    await readProductStorageJson<unknown>(
      context,
      LEGACY_REPO_CONFIGS_KEY,
    );
  return normalizePersistedRepoConfigs(legacyRepoConfigs);
}

export async function persistRepoPreferences(
  repoConfigs: Record<string, RepoConfig>,
  context: ProductStorageContext,
): Promise<void> {
  await writeProductStorageJson(context, REPO_PREFERENCES_KEY, repoConfigs);
}

function normalizePersistedRepoConfigs(value: unknown): Record<string, RepoConfig> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const input: PersistedRepoConfigInput = {};
  for (const [sourceRoot, candidate] of Object.entries(value)) {
    if (!isPlainRecord(candidate)) {
      continue;
    }
    input[sourceRoot] = {
      ...(candidate.defaultBranch === null || typeof candidate.defaultBranch === "string"
        ? { defaultBranch: candidate.defaultBranch }
        : {}),
      ...(typeof candidate.setupScript === "string"
        ? { setupScript: candidate.setupScript }
        : {}),
      ...(typeof candidate.runCommand === "string"
        ? { runCommand: candidate.runCommand }
        : {}),
    };
  }
  return normalizeRepoConfigs(input);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
