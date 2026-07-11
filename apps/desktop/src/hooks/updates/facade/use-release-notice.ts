import { useMemo } from "react";
import { useReleaseNoticeModel } from "@/hooks/updates/cache/use-release-notice-model";
import { useInstalledReleaseTitleCacheLifecycle } from "@/hooks/updates/lifecycle/use-installed-release-title-cache-lifecycle";
import { useReleaseNoticeActions } from "@/hooks/updates/workflows/use-release-notice-actions";
import type { ReleaseNotice } from "@/lib/domain/updates/release-notice";

export function useReleaseNotice(): {
  notice: ReleaseNotice | null;
  dismissNotice: () => void;
  openChangelog: () => void;
} {
  const model = useReleaseNoticeModel();
  useInstalledReleaseTitleCacheLifecycle(model.installedManifest);
  const actions = useReleaseNoticeActions(model.notice);

  return useMemo(() => ({
    notice: model.notice,
    dismissNotice: actions.dismissNotice,
    openChangelog: actions.openChangelog,
  }), [actions.dismissNotice, actions.openChangelog, model.notice]);
}
