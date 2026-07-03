import { useCallback, useMemo } from "react";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/derived/use-selected-logical-workspace";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceOpenInWebActions() {
  const { selectedLogicalWorkspace } = useSelectedLogicalWorkspace();
  const { copyText, openExternal } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const cloudWorkspaceId = selectedLogicalWorkspace?.cloudWorkspace?.id
    ?? null;
  const url = useMemo(() => (
    cloudWorkspaceId
      ? webWorkspaceDeepLink(cloudWorkspaceId, getProliferateWebBaseUrl())
      : null
  ), [cloudWorkspaceId]);
  const disabledReason = url
    ? null
    : "Enable remote access first.";
  const title = url
    ? "Open this workspace in the web app."
    : "Enable remote access first to open this workspace from web and mobile.";

  const openCurrentWorkspaceInWeb = useCallback(() => {
    if (disabledReason) {
      showToast(disabledReason);
      return;
    }
    if (!url) {
      showToast("Enable remote access first.");
      return;
    }

    void (async () => {
      try {
        await copyText(url);
        showToast("Workspace link copied. Opening in web...", "info");
      } catch {
        showToast("Opening workspace in web. Failed to copy link.");
      }

      try {
        await openExternal(url);
      } catch {
        showToast("Failed to open the web workspace.");
      }
    })();
  }, [copyText, disabledReason, openExternal, showToast, url]);

  return {
    disabled: disabledReason !== null,
    disabledReason,
    openCurrentWorkspaceInWeb,
    title,
    url,
  };
}
