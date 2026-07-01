import { useCallback } from "react";
import { useToastStore } from "@/stores/toast/toast-store";

const DISABLED_REASON = "Cloud workspaces now open through the managed sandbox gateway.";

export function useWorkspaceRemoteAccessActions() {
  const showToast = useToastStore((state) => state.show);

  const notifyDisabled = useCallback(() => {
    showToast(DISABLED_REASON, "info");
  }, [showToast]);

  return {
    disabled: true,
    handleClick: notifyDisabled,
    isEnabled: false,
    isPending: false,
    label: "Remote access unavailable",
    syncToWeb: notifyDisabled,
    syncToWebDisabledReason: DISABLED_REASON,
    title: DISABLED_REASON,
  };
}
