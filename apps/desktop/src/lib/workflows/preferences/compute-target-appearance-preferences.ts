import {
  normalizeComputeTargetAppearancePreference,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";

const COMPUTE_TARGET_APPEARANCE_KEY = "compute_target_appearance_preferences";

export interface ComputeTargetAppearancePreferencesDependencies {
  readPersistedValue(key: string): Promise<unknown>;
  persistValue(key: string, value: unknown): Promise<void>;
}

async function readAppearancePreferences(
  dependencies: ComputeTargetAppearancePreferencesDependencies,
): Promise<
  Record<string, ComputeTargetAppearancePreference>
> {
  const persisted = await dependencies.readPersistedValue(
    COMPUTE_TARGET_APPEARANCE_KEY,
  );
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return {};
  }
  const preferences: Record<string, ComputeTargetAppearancePreference> = {};
  for (const value of Object.values(persisted)) {
    const preference = normalizeComputeTargetAppearancePreference(value);
    if (preference) {
      preferences[preference.targetId] = preference;
    }
  }
  return preferences;
}

export async function getComputeTargetAppearancePreferences(
  dependencies: ComputeTargetAppearancePreferencesDependencies,
): Promise<Record<string, ComputeTargetAppearancePreference>> {
  return await readAppearancePreferences(dependencies);
}

export async function setComputeTargetAppearancePreference(
  preference: ComputeTargetAppearancePreference,
  dependencies: ComputeTargetAppearancePreferencesDependencies,
): Promise<void> {
  const normalized = normalizeComputeTargetAppearancePreference(preference);
  if (!normalized) {
    throw new Error("Target appearance requires a target id.");
  }
  const preferences = await readAppearancePreferences(dependencies);
  preferences[normalized.targetId] = normalized;
  await dependencies.persistValue(COMPUTE_TARGET_APPEARANCE_KEY, preferences);
}
