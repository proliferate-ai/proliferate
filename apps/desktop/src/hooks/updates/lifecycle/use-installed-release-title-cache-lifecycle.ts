import { useEffect } from "react";
import {
  normalizeReleaseTitlePair,
  type DesktopReleaseManifest,
  type InstalledReleaseManifestStatus,
} from "@/lib/domain/updates/release-notice";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

// Keeps exactly one valid current installed version/title pair as the quiet
// offline fallback. A successful no-title manifest clears any stale pair.
export function useInstalledReleaseTitleCacheLifecycle(input: {
  currentVersion: string | null;
  status: InstalledReleaseManifestStatus;
  data: DesktopReleaseManifest | null;
}): void {
  const hydrated = useUserPreferencesStore((state) => state._hydrated);
  const cachedInstalledRelease = useUserPreferencesStore(
    (state) => state.cachedInstalledRelease,
  );
  const setPreference = useUserPreferencesStore((state) => state.set);

  useEffect(() => {
    if (!hydrated || !input.currentVersion) {
      return;
    }

    const normalizedCachedRelease = normalizeReleaseTitlePair(
      cachedInstalledRelease,
    );
    if (
      cachedInstalledRelease !== null
      && (
        normalizedCachedRelease?.version !== input.currentVersion
        || JSON.stringify(normalizedCachedRelease)
          !== JSON.stringify(cachedInstalledRelease)
      )
    ) {
      setPreference("cachedInstalledRelease", null);
      return;
    }

    if (input.status !== "success") {
      return;
    }

    const nextCachedRelease = input.data?.version === input.currentVersion
      ? normalizeReleaseTitlePair(input.data)
      : null;
    if (
      JSON.stringify(nextCachedRelease)
      === JSON.stringify(cachedInstalledRelease)
    ) {
      return;
    }

    setPreference("cachedInstalledRelease", nextCachedRelease);
  }, [
    cachedInstalledRelease,
    hydrated,
    input.currentVersion,
    input.data,
    input.status,
    setPreference,
  ]);
}
