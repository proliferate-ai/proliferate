import { readSelectedOrganizationCookie } from "@/lib/access/browser/organization-selection-cookie";

const OWNER_SCOPE_HEADER = "X-Proliferate-Owner-Scope";
const ORGANIZATION_ID_HEADER = "X-Proliferate-Org-Id";

export function applySelectedOrganizationHeaders(headers: Headers): void {
  const organizationId = readSelectedOrganizationCookie();
  if (!organizationId) {
    return;
  }

  headers.set(OWNER_SCOPE_HEADER, "organization");
  headers.set(ORGANIZATION_ID_HEADER, organizationId);
}
