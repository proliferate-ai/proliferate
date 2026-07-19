import { useMemo } from "react";
import type { CloudOwnerSelection } from "#product/lib/domain/cloud/billing";
import { useOrganizationStore } from "#product/stores/organizations/organization-store";

/** The validated owner selected for owner-scoped Cloud reads. */
export function useSelectedCloudOwner(): CloudOwnerSelection {
  const activeOrganizationId = useOrganizationStore((state) => state.activeOrganizationId);
  const activeOrganizationValidated = useOrganizationStore(
    (state) => state.activeOrganizationValidated,
  );

  return useMemo(() => (
    activeOrganizationId && activeOrganizationValidated
      ? { ownerScope: "organization", organizationId: activeOrganizationId }
      : { ownerScope: "personal", organizationId: null }
  ), [activeOrganizationId, activeOrganizationValidated]);
}
