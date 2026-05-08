import { useEffect } from "react";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

const EMPTY_ORGANIZATIONS: never[] = [];

// Owns the settings-facing active organization model.
// Does not own organization cloud queries or mutations.
export function useActiveOrganization() {
  const activeOrganizationId = useOrganizationStore((state) => state.activeOrganizationId);
  const setActiveOrganizationId = useOrganizationStore((state) => state.setActiveOrganizationId);
  const clearActiveOrganizationId = useOrganizationStore((state) => state.clearActiveOrganizationId);
  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data?.organizations ?? EMPTY_ORGANIZATIONS;

  useEffect(() => {
    if (!activeOrganizationId || organizationsQuery.isLoading) {
      return;
    }
    if (!organizations.some((organization) => organization.id === activeOrganizationId)) {
      clearActiveOrganizationId();
    }
  }, [
    activeOrganizationId,
    clearActiveOrganizationId,
    organizations,
    organizationsQuery.isLoading,
  ]);

  const activeOrganization = activeOrganizationId
    ? organizations.find((organization) => organization.id === activeOrganizationId) ?? null
    : organizations[0] ?? null;

  return {
    activeOrganization,
    activeOrganizationId: activeOrganization?.id ?? null,
    organizations,
    organizationsQuery,
    setActiveOrganizationId,
    clearActiveOrganizationId,
  };
}
