import { useCallback, useMemo } from "react";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceOpenInWebActions() {
  const mobility = useWorkspaceMobilityState();
  const { openExternal } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const cloudWorkspaceId = mobility.selectedLogicalWorkspace?.cloudWorkspace?.id
    ?? mobility.selectedLogicalWorkspace?.mobilityWorkspace?.cloudWorkspaceId
    ?? null;
  const url = useMemo(() => (
    cloudWorkspaceId
      ? webWorkspaceDeepLink(cloudWorkspaceId, getProliferateWebBaseUrl())
      : null
  ), [cloudWorkspaceId]);
  const disabledReason = mobility.selectionLocked
    ? "Workspace sync is still finishing."
    : url
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

    showToast("Opening workspace in web...", "info");
    void openExternal(url).catch(() => {
      showToast("Failed to open the web workspace.");
    });
  }, [disabledReason, openExternal, showToast, url]);

  return {
    disabled: disabledReason !== null,
    disabledReason,
    openCurrentWorkspaceInWeb,
    title,
    url,
  };
}
