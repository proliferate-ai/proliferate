import { useCallback } from "react";
import { useProductAuthActions } from "@/hooks/auth/workflows/use-product-auth-actions";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function useAppSidebarSignOutAction() {
  const { logout } = useProductAuthActions();
  const { clearActiveOrganizationId } = useOrganizationSelectionActions();
  const showToast = useToastStore((state) => state.show);

  return useCallback(() => {
    void logout()
      .then(() => {
        clearActiveOrganizationId();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not sign out.";
        showToast(message);
      });
  }, [clearActiveOrganizationId, logout, showToast]);
}
