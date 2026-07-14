import { useCallback, useEffect, useState } from "react";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  setComputeTargetAppearancePreference,
  type ComputeTargetAppearancePreferencesDependencies,
} from "@/lib/workflows/preferences/compute-target-appearance-preferences";
import {
  persistValue,
  readPersistedValue,
} from "@/lib/infra/persistence/preferences-persistence";

const persistence: ComputeTargetAppearancePreferencesDependencies = {
  readPersistedValue,
  persistValue,
};

export function useComputeTargetAppearancePreferences() {
  const [preferences, setPreferences] = useState<
    Record<string, ComputeTargetAppearancePreference>
  >({});
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await getComputeTargetAppearancePreferences(persistence));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const savePreference = useCallback(async (
    preference: ComputeTargetAppearancePreference,
  ) => {
    await setComputeTargetAppearancePreference(preference, persistence);
    setPreferences((current) => ({
      ...current,
      [preference.targetId]: preference,
    }));
  }, []);

  return {
    preferences,
    loading,
    reload,
    savePreference,
  };
}
