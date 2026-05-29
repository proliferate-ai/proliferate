import { useCallback, useMemo } from "react";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import { ExternalLink } from "@proliferate/ui/icons";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { useToastStore } from "@/stores/toast/toast-store";
import { ComposerControlButton } from "@proliferate/product-ui/chat/composer/ComposerControlButton";

export function WorkspaceOpenInWebFooterControl() {
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
  const disabled = mobility.selectionLocked || !url;
  const title = url
    ? "Open this workspace in the web app."
    : "Enable remote access first to open this workspace from web and mobile.";

  const handleClick = useCallback(async () => {
    if (!url) {
      showToast("Enable remote access first.");
      return;
    }
    try {
      await openExternal(url);
    } catch {
      showToast("Failed to open the web workspace.");
    }
  }, [openExternal, showToast, url]);

  return (
    <ComposerControlButton
      icon={<ExternalLink className="size-3.5" />}
      label="Open in web"
      detail={!url ? "Sync first" : null}
      disabled={disabled}
      onClick={handleClick}
      title={title}
      className="shrink-0"
    />
  );
}
