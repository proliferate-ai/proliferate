import { CloudOrganizationSsoSettingsSurface } from "#product/components/settings/panes/organization/CloudOrganizationSsoSettingsSurface";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";

export function OrganizationSsoPane() {
  const { activeOrganizationId } = useActiveOrganization();
  return (
    <CloudOrganizationSsoSettingsSurface
      organizationId={activeOrganizationId}
    />
  );
}
