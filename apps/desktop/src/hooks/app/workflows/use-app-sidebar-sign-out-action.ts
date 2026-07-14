import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function useAppSidebarSignOutAction() {
  const { logout } = useProductHost().auth;
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
  }, [clearActiveOrganizationId, showToast, logout]);
}
