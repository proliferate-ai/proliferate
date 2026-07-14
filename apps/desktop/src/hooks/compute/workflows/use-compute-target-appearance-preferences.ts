import { useCallback, useEffect, useMemo, useState } from "react";
import { useProductStorageContext } from "@/hooks/persistence/use-product-storage-context";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  setComputeTargetAppearancePreference,
  type ComputeTargetAppearancePreferencesDependencies,
} from "@/lib/workflows/preferences/compute-target-appearance-preferences";
import {
  readPersistedJsonValue,
  writePersistedJson,
} from "@/lib/infra/persistence/product-storage";

export function useComputeTargetAppearancePreferences() {
  const storage = useProductStorageContext();
  const persistence = useMemo<ComputeTargetAppearancePreferencesDependencies>(
    () => ({
      readPersistedValue: (key) => readPersistedJsonValue(storage, key),
      persistValue: (key, value) => writePersistedJson(storage, key, value),
    }),
    [storage],
  );

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
  }, [persistence]);

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
  }, [persistence]);

  return {
    preferences,
    loading,
    reload,
    savePreference,
  };
}
