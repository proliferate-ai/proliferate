import {
  normalizeComputeTargetAppearancePreference,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";
import {
  persistValue,
  readPersistedValue,
} from "@/lib/infra/persistence/preferences-persistence";

const COMPUTE_TARGET_APPEARANCE_KEY = "compute_target_appearance_preferences";

async function readAppearancePreferences(): Promise<
  Record<string, ComputeTargetAppearancePreference>
> {
  const persisted = await readPersistedValue<Record<string, unknown>>(
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

export async function getComputeTargetAppearancePreferences(): Promise<
  Record<string, ComputeTargetAppearancePreference>
> {
  return await readAppearancePreferences();
}

export async function setComputeTargetAppearancePreference(
  preference: ComputeTargetAppearancePreference,
): Promise<void> {
  const normalized = normalizeComputeTargetAppearancePreference(preference);
  if (!normalized) {
    throw new Error("Target appearance requires a target id.");
  }
  const preferences = await readAppearancePreferences();
  preferences[normalized.targetId] = normalized;
  await persistValue(COMPUTE_TARGET_APPEARANCE_KEY, preferences);
}
