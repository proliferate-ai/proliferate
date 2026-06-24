import { CloudOrganizationSsoSettingsSurface } from "@proliferate/product-surfaces/settings/CloudOrganizationSsoSettingsSurface";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";

export function OrganizationSsoPane() {
  const { activeOrganizationId } = useActiveOrganization();
  return (
    <CloudOrganizationSsoSettingsSurface
      organizationId={activeOrganizationId}
    />
  );
}
