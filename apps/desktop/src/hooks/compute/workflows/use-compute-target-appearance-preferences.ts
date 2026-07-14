import { useCallback, useEffect, useState } from "react";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  setComputeTargetAppearancePreference,
} from "@/lib/workflows/preferences/compute-target-appearance-preferences";

export function useComputeTargetAppearancePreferences() {
  const [preferences, setPreferences] = useState<
    Record<string, ComputeTargetAppearancePreference>
  >({});
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await getComputeTargetAppearancePreferences());
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
    await setComputeTargetAppearancePreference(preference);
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
