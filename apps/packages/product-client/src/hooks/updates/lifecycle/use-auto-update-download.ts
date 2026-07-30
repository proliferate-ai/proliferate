import { useEffect, useRef } from "react";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

/**
 * Starts the download the moment an update is available, unless the user turned
 * "Keep Proliferate up to date" off.
 *
 * This makes the existing copy true instead of deleting it: the toast already
 * promised a background download, so a background download is what happens. The
 * consequence is that `available` stops being a surface at all in the default
 * configuration — the pill's progress ring is the whole story until `ready`.
 * When auto-update is off, a click is genuinely required and the `available`
 * announcement is honest about asking for one.
 */
export function useAutoUpdateDownload(): void {
  const { phase, availableVersion, downloadUpdate } = useUpdater();
  const autoUpdateEnabled = useUserPreferencesStore((s) => s.autoUpdateEnabled);
  const hydrated = useUserPreferencesStore((s) => s._hydrated);
  // One auto-start per version: a re-render of `available` must not re-enter
  // the download, and a failure must not be retried silently forever.
  const startedForVersion = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== "available") {
      if (phase === "idle" || phase === "current") {
        startedForVersion.current = null;
      }
      return;
    }
    if (!hydrated || !autoUpdateEnabled) {
      return;
    }
    const version = availableVersion ?? "unknown";
    if (startedForVersion.current === version) {
      return;
    }
    startedForVersion.current = version;
    void downloadUpdate();
  }, [autoUpdateEnabled, availableVersion, downloadUpdate, hydrated, phase]);
}
