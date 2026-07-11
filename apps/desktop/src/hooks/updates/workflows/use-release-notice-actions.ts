import { useCallback, useMemo } from "react";
import { RELEASE_NOTICE_CHANGELOG_URL } from "@/config/release-notice";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import type { ReleaseNotice } from "@/lib/domain/updates/release-notice";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useReleaseNoticeActions(notice: ReleaseNotice | null) {
  const setPreference = useUserPreferencesStore(
    (state) => state.set,
  );
  const { openExternal } = useTauriShellActions();

  const dismissNotice = useCallback(() => {
    if (!notice) {
      return;
    }

    setPreference("acknowledgedReleaseVersion", notice.version);
  }, [notice, setPreference]);

  const openChangelog = useCallback(() => {
    if (!notice) {
      return;
    }

    void openExternal(RELEASE_NOTICE_CHANGELOG_URL)
      .then(() => {
        setPreference("acknowledgedReleaseVersion", notice.version);
      })
      .catch(() => undefined);
  }, [notice, openExternal, setPreference]);

  return useMemo(() => ({
    dismissNotice,
    openChangelog,
  }), [dismissNotice, openChangelog]);
}
