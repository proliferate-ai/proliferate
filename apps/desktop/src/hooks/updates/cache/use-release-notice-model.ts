import { useMemo } from "react";
import { useDesktopReleaseManifest } from "@/hooks/access/downloads/desktop-releases/use-desktop-release-manifest";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import {
  normalizeReleaseVersion,
  resolveInstalledReleaseTitle,
  selectReleaseNotice,
  type DesktopReleaseManifest,
  type InstalledReleaseManifestStatus,
  type ReleaseNotice,
} from "@/lib/domain/updates/release-notice";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export interface ReleaseNoticeModel {
  notice: ReleaseNotice | null;
  installedManifest: {
    currentVersion: string | null;
    status: InstalledReleaseManifestStatus;
    data: DesktopReleaseManifest | null;
  };
}

// Composes updater, installed-manifest, and local preference state into one
// release-notice read model. Persistence and actions stay in owning hooks.
export function useReleaseNoticeModel(): ReleaseNoticeModel {
  const { updatesSupported } = useUpdater();
  const appVersionQuery = useAppVersion();
  const currentVersion = normalizeReleaseVersion(appVersionQuery.data);
  const installedVersion = updatesSupported ? currentVersion : null;
  const installedManifestQuery = useDesktopReleaseManifest(installedVersion);
  const hydrated = useUserPreferencesStore((state) => state._hydrated);
  const acknowledgedReleaseVersion = useUserPreferencesStore(
    (state) => state.acknowledgedReleaseVersion,
  );
  const cachedInstalledRelease = useUserPreferencesStore(
    (state) => state.cachedInstalledRelease,
  );

  const installedRelease = useMemo(() => resolveInstalledReleaseTitle({
    currentVersion: installedVersion,
    manifestStatus: installedManifestQuery.status,
    manifest: installedManifestQuery.data,
    cachedRelease: cachedInstalledRelease,
  }), [
    cachedInstalledRelease,
    installedVersion,
    installedManifestQuery.data,
    installedManifestQuery.status,
  ]);

  const notice = useMemo(() => (
    hydrated
      ? selectReleaseNotice({
          installedRelease,
          acknowledgedReleaseVersion,
        })
      : null
  ), [
    acknowledgedReleaseVersion,
    hydrated,
    installedRelease,
  ]);

  return useMemo(() => ({
    notice,
    installedManifest: {
      currentVersion: installedVersion,
      status: installedManifestQuery.status,
      data: installedManifestQuery.data ?? null,
    },
  }), [
    installedVersion,
    installedManifestQuery.data,
    installedManifestQuery.status,
    notice,
  ]);
}
