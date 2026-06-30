import { CloudOrganizationIntegrationsPolicySurface } from "@proliferate/product-surfaces/settings/CloudOrganizationIntegrationsPolicySurface";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";

export function OrganizationIntegrationsPane() {
  const { activeOrganizationId } = useActiveOrganization();
  return (
    <CloudOrganizationIntegrationsPolicySurface
      organizationId={activeOrganizationId}
    />
  );
}
