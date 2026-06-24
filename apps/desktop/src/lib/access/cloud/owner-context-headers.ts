import { useOrganizationStore } from "@/stores/organizations/organization-store";

const OWNER_SCOPE_HEADER = "X-Proliferate-Owner-Scope";
const ORGANIZATION_ID_HEADER = "X-Proliferate-Org-Id";

export function applySelectedOrganizationHeaders(headers: Headers): void {
  const { activeOrganizationId, activeOrganizationValidated } = useOrganizationStore.getState();
  if (!activeOrganizationId || !activeOrganizationValidated) {
    return;
  }

  headers.set(OWNER_SCOPE_HEADER, "organization");
  headers.set(ORGANIZATION_ID_HEADER, activeOrganizationId);
}
