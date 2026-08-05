import { OrganizationSsoSettingsSurface } from "@proliferate/product-ui/settings/OrganizationSsoSettingsSurface";
import { useOrganizationSsoSettingsWorkflow } from "#product/hooks/settings/workflows/use-organization-sso-settings-workflow";

interface CloudOrganizationSsoSettingsSurfaceProps {
  organizationId: string | null;
  enabled?: boolean;
}

export function CloudOrganizationSsoSettingsSurface({
  organizationId,
  enabled = true,
}: CloudOrganizationSsoSettingsSurfaceProps) {
  const settings = useOrganizationSsoSettingsWorkflow({ organizationId, enabled });

  return <OrganizationSsoSettingsSurface {...settings} />;
}
