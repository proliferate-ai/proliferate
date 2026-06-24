import { useCallback } from "react";
import {
  clearSelectedOrganizationCookie,
  writeSelectedOrganizationCookie,
} from "@/lib/access/browser/organization-selection-cookie";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

export function useOrganizationSelectionActions() {
  const setStoredActiveOrganizationId = useOrganizationStore(
    (state) => state.setActiveOrganizationId,
  );
  const clearStoredActiveOrganizationId = useOrganizationStore(
    (state) => state.clearActiveOrganizationId,
  );

  const setActiveOrganizationId = useCallback((
    organizationId: string | null,
  ) => {
    if (organizationId) {
      writeSelectedOrganizationCookie(organizationId);
      setStoredActiveOrganizationId(organizationId);
      return;
    }
    clearSelectedOrganizationCookie();
    clearStoredActiveOrganizationId();
  }, [clearStoredActiveOrganizationId, setStoredActiveOrganizationId]);

  const clearActiveOrganizationId = useCallback(() => {
    clearSelectedOrganizationCookie();
    clearStoredActiveOrganizationId();
  }, [clearStoredActiveOrganizationId]);

  return {
    setActiveOrganizationId,
    clearActiveOrganizationId,
  };
}
