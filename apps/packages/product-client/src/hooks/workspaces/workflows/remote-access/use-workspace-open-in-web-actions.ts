import { useCallback } from "react";
import { useWebAppTarget } from "#product/hooks/capabilities/derived/use-web-app-target";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * The cloud workspace stack is deleted, so there is no cloud workspace id to
 * build a web deep link from: the open-in-web affordance is permanently
 * disabled, with the reason preserved for the menu copy.
 */
export function useWorkspaceOpenInWebActions() {
  const webApp = useWebAppTarget();
  const showToast = useToastStore((state) => state.show);
  const disabledReason = !webApp.available
    ? "The web app is not available for this server."
    : "Opening workspaces on the web is no longer available.";
  const title = "Opening workspaces on the web is no longer available.";

  const openCurrentWorkspaceInWeb = useCallback(() => {
    showToast(disabledReason);
  }, [disabledReason, showToast]);

  return {
    disabled: true,
    disabledReason,
    openCurrentWorkspaceInWeb,
    title,
    url: null,
  };
}
