import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  setComputeTargetAppearancePreference,
  type ComputeTargetAppearancePreferencesDependencies,
} from "@/lib/workflows/preferences/compute-target-appearance-preferences";
import {
  readProductStorageJson,
  writeProductStorageJson,
} from "@/lib/infra/persistence/product-storage";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

export function useComputeTargetAppearancePreferences() {
  const storageContext = useProductStorageContext();
  const persistence = useMemo<ComputeTargetAppearancePreferencesDependencies>(
    () => ({
      readPersistedValue: (key) => readProductStorageJson(storageContext, key),
      persistValue: async (key, value) => {
        await writeProductStorageJson(storageContext, key, value);
      },
    }),
    [storageContext],
  );
  const [preferences, setPreferences] = useState<
    Record<string, ComputeTargetAppearancePreference>
  >({});
  const [loading, setLoading] = useState(false);
  const activeTokenRef = useRef<symbol | null>(null);

  const reload = useCallback(async () => {
    const activeToken = activeTokenRef.current;
    setLoading(true);
    try {
      const next = await getComputeTargetAppearancePreferences(persistence);
      if (activeTokenRef.current === activeToken) {
        setPreferences(next);
      }
    } finally {
      if (activeTokenRef.current === activeToken) {
        setLoading(false);
      }
    }
  }, [persistence]);

  useEffect(() => {
    const activeToken = Symbol("compute-target-appearance-persistence");
    activeTokenRef.current = activeToken;
    void reload();
    return () => {
      if (activeTokenRef.current === activeToken) {
        activeTokenRef.current = null;
      }
    };
  }, [reload]);

  const savePreference = useCallback(async (
    preference: ComputeTargetAppearancePreference,
  ) => {
    const activeToken = activeTokenRef.current;
    const next = await setComputeTargetAppearancePreference(
      preference,
      persistence,
    );
    if (activeTokenRef.current === activeToken) {
      setPreferences(next);
    }
  }, [persistence]);

  return {
    preferences,
    loading,
    reload,
    savePreference,
  };
}
