import { useCurrentTeam } from "@proliferate/cloud-sdk-react";
import { CloudOrganizationSsoSettingsSurface } from "@proliferate/product-surfaces/settings/CloudOrganizationSsoSettingsSurface";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

export function SsoSettingsSection() {
  const currentTeam = useCurrentTeam();
  const team = currentTeam.data ?? null;
  const teamRole = team?.membership?.role ?? null;
  const canManageTeam = Boolean(
    team?.membership?.status === "active" && (teamRole === "owner" || teamRole === "admin"),
  );

  if (!currentTeam.isLoading && team && !canManageTeam) {
    return (
      <div className="space-y-5">
        <SettingsPageHeader
          title="Single sign-on"
          description="Manage organization SSO configuration."
        />
        <SettingsSection>
          <SettingsRow
            label="Admin access required"
            description="Team SSO is managed by owners and admins."
          />
        </SettingsSection>
      </div>
    );
  }

  return (
    <CloudOrganizationSsoSettingsSurface
      organizationId={canManageTeam ? team?.id ?? null : null}
      enabled={!currentTeam.isLoading && canManageTeam}
    />
  );
}
