import { useEffect, useRef } from "react";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import {
  clearSelectedOrganizationCookie,
  readSelectedOrganizationCookie,
  writeSelectedOrganizationCookie,
} from "@/lib/access/browser/organization-selection-cookie";
import { useOrganizationStore } from "@/stores/organizations/organization-store";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "@/hooks/auth/facade/use-product-auth";

export function useOrganizationSelectionLifecycle() {
  const authStatus = useProductAuthStatus();
  const authUserId = useProductAuthUserId();
  const organizationsQuery = useOrganizations();
  const activeOrganizationId = useOrganizationStore((state) => state.activeOrganizationId);
  const setActiveOrganizationId = useOrganizationStore((state) => state.setActiveOrganizationId);
  const markActiveOrganizationIdValidated = useOrganizationStore(
    (state) => state.markActiveOrganizationIdValidated,
  );
  const clearActiveOrganizationId = useOrganizationStore((state) => state.clearActiveOrganizationId);
  const hydratedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (authStatus === "loading") {
      return;
    }
    if (authStatus !== "authenticated" || !authUserId) {
      hydratedUserIdRef.current = null;
      clearSelectedOrganizationCookie();
      clearActiveOrganizationId();
      return;
    }
    if (hydratedUserIdRef.current === authUserId) {
      return;
    }
    hydratedUserIdRef.current = authUserId;
    const cookieOrganizationId = readSelectedOrganizationCookie();
    if (cookieOrganizationId) {
      setActiveOrganizationId(cookieOrganizationId);
      return;
    }
    clearActiveOrganizationId();
  }, [authStatus, authUserId, clearActiveOrganizationId, setActiveOrganizationId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !organizationsQuery.isSuccess) {
      return;
    }
    const organizations = organizationsQuery.data.organizations;
    const fallbackOrganizationId = organizations[0]?.id ?? null;
    if (!activeOrganizationId) {
      if (fallbackOrganizationId) {
        writeSelectedOrganizationCookie(fallbackOrganizationId);
        setActiveOrganizationId(fallbackOrganizationId, { validated: true });
      }
      return;
    }
    const organizationExists = organizations.some(
      (organization) => organization.id === activeOrganizationId,
    );
    if (organizationExists) {
      markActiveOrganizationIdValidated();
      return;
    }
    if (fallbackOrganizationId) {
      writeSelectedOrganizationCookie(fallbackOrganizationId);
      setActiveOrganizationId(fallbackOrganizationId, { validated: true });
      return;
    }
    clearSelectedOrganizationCookie();
    clearActiveOrganizationId();
  }, [
    activeOrganizationId,
    authStatus,
    clearActiveOrganizationId,
    markActiveOrganizationIdValidated,
    organizationsQuery.data?.organizations,
    organizationsQuery.isSuccess,
    setActiveOrganizationId,
  ]);
}
