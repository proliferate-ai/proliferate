import { useCallback } from "react";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function useAppSidebarSignOutAction() {
  const { signOut } = useAuthActions();
  const { clearActiveOrganizationId } = useOrganizationSelectionActions();
  const showToast = useToastStore((state) => state.show);

  return useCallback(() => {
    void signOut()
      .then(() => {
        clearActiveOrganizationId();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not sign out.";
        showToast(message);
      });
  }, [clearActiveOrganizationId, showToast, signOut]);
}
