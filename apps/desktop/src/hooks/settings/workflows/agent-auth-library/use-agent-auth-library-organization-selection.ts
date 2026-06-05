import { useEffect, useMemo, useState } from "react";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import { isSettingsAdminRole } from "@/lib/domain/settings/admin-roles";

export type AgentAuthLibraryOrganizationOption =
  NonNullable<ReturnType<typeof useOrganizations>["data"]>["organizations"][number];

export function useAgentAuthLibraryOrganizationSelection(initialOrganizationId: string | null) {
  const organizations = useOrganizations();
  const organizationOptions = organizations.data?.organizations ?? [];
  const organizationIdsKey = organizationOptions.map((organization) => organization.id).join(":");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const selectedOrganization = organizationOptions.find(
    (organization) => organization.id === selectedOrganizationId,
  ) ?? null;
  const adminOrganizationIds = useMemo(
    () => new Set(
      organizationOptions
        .filter(isAdminOrganization)
        .map((organization) => organization.id),
    ),
    [organizationOptions],
  );
  const isAdminForSelectedOrganization = Boolean(
    selectedOrganizationId && adminOrganizationIds.has(selectedOrganizationId),
  );

  useEffect(() => {
    if (organizationOptions.length === 0) {
      if (selectedOrganizationId !== null) {
        setSelectedOrganizationId(null);
      }
      return;
    }
    const nextSelectedId =
      initialOrganizationId
      && organizationOptions.some((organization) => organization.id === initialOrganizationId)
        ? initialOrganizationId
        : organizationOptions[0].id;
    if (
      selectedOrganizationId === null
      || !organizationOptions.some((organization) => organization.id === selectedOrganizationId)
      || (initialOrganizationId !== null && selectedOrganizationId !== nextSelectedId)
    ) {
      setSelectedOrganizationId(nextSelectedId);
    }
  }, [initialOrganizationId, organizationIdsKey, organizationOptions, selectedOrganizationId]);

  return {
    organizationOptions,
    selectedOrganizationId,
    selectedOrganization,
    setSelectedOrganizationId,
    isAdminForSelectedOrganization,
  };
}

function isAdminOrganization(organization: AgentAuthLibraryOrganizationOption): boolean {
  return isSettingsAdminRole(organization.membership?.role);
}
