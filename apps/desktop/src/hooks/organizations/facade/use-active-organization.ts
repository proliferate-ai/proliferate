import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import { useOrganizationSelectionActions } from "@/hooks/organizations/workflows/use-organization-selection-actions";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

const EMPTY_ORGANIZATIONS: never[] = [];

// Owns the settings-facing active organization model.
// Does not own organization cloud queries or mutations.
export function useActiveOrganization() {
  const organizationsQuery = useOrganizations();
  const selectedOrganizationId = useOrganizationStore((state) => state.activeOrganizationId);
  const {
    setActiveOrganizationId,
    clearActiveOrganizationId,
  } = useOrganizationSelectionActions();
  const organizations = organizationsQuery.data?.organizations ?? EMPTY_ORGANIZATIONS;
  const selectedOrganization = selectedOrganizationId
    ? organizations.find((organization) => organization.id === selectedOrganizationId) ?? null
    : null;
  const activeOrganization = selectedOrganization ?? organizations[0] ?? null;

  return {
    activeOrganization,
    activeOrganizationId: activeOrganization?.id ?? null,
    organizations,
    organizationsQuery,
    setActiveOrganizationId,
    clearActiveOrganizationId,
  };
}
