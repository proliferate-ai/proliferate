import { useCallback } from "react";
import { useSessionInteractionActions } from "@/hooks/sessions/workflows/use-session-interaction-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function useChatPermissionActions() {
  const showToast = useToastStore((state) => state.show);
  const { resolvePermission } = useSessionInteractionActions();

  const handleSelectPermissionOption = useCallback((optionId: string) => {
    void resolvePermission({ optionId }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [resolvePermission, showToast]);

  const handleAllowPermission = useCallback(() => {
    void resolvePermission({ decision: "allow" }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [resolvePermission, showToast]);

  const handleDenyPermission = useCallback(() => {
    void resolvePermission({ decision: "deny" }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [resolvePermission, showToast]);

  return {
    handleSelectPermissionOption,
    handleAllowPermission,
    handleDenyPermission,
  };
}
