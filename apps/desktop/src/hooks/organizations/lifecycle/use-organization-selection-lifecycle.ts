import { useEffect, useRef } from "react";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import {
  clearSelectedOrganizationCookie,
  readSelectedOrganizationCookie,
} from "@/lib/access/browser/organization-selection-cookie";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

export function useOrganizationSelectionLifecycle() {
  const organizationsQuery = useOrganizations();
  const activeOrganizationId = useOrganizationStore((state) => state.activeOrganizationId);
  const setActiveOrganizationId = useOrganizationStore((state) => state.setActiveOrganizationId);
  const clearActiveOrganizationId = useOrganizationStore((state) => state.clearActiveOrganizationId);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;
    const cookieOrganizationId = readSelectedOrganizationCookie();
    if (cookieOrganizationId) {
      setActiveOrganizationId(cookieOrganizationId);
    }
  }, [setActiveOrganizationId]);

  useEffect(() => {
    if (!organizationsQuery.isSuccess || !activeOrganizationId) {
      return;
    }
    const organizationExists = organizationsQuery.data.organizations.some(
      (organization) => organization.id === activeOrganizationId,
    );
    if (!organizationExists) {
      clearSelectedOrganizationCookie();
      clearActiveOrganizationId();
    }
  }, [
    activeOrganizationId,
    clearActiveOrganizationId,
    organizationsQuery.data?.organizations,
    organizationsQuery.isSuccess,
  ]);
}
