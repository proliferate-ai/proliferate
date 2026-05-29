import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";

const EMPTY_ORGANIZATIONS: never[] = [];

// Owns the settings-facing active organization model.
// Does not own organization cloud queries or mutations.
export function useActiveOrganization() {
  const organizationsQuery = useOrganizations();
  const organizations = organizationsQuery.data?.organizations ?? EMPTY_ORGANIZATIONS;
  const activeOrganization = organizations[0] ?? null;
  const ignoreOrganizationSelection = (_organizationId: string | null) => {};

  return {
    activeOrganization,
    activeOrganizationId: activeOrganization?.id ?? null,
    organizations,
    organizationsQuery,
    setActiveOrganizationId: ignoreOrganizationSelection,
    clearActiveOrganizationId: () => {},
  };
}
