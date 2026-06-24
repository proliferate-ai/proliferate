import { useCurrentTeam } from "@proliferate/cloud-sdk-react";
import { CloudOrganizationSsoSettingsSurface } from "@proliferate/product-surfaces/settings/CloudOrganizationSsoSettingsSurface";

export function SsoSettingsSection() {
  const currentTeam = useCurrentTeam();
  return (
    <CloudOrganizationSsoSettingsSurface
      organizationId={currentTeam.data?.id ?? null}
      enabled={!currentTeam.isLoading}
    />
  );
}
