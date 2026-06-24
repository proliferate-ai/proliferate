import { useCurrentTeam } from "@proliferate/cloud-sdk-react";
import { CloudOrganizationSsoSettingsSurface } from "@proliferate/product-surfaces/settings/CloudOrganizationSsoSettingsSurface";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
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
        <SettingsCard>
          <SettingsCardRow
            label="Admin access required"
            description="Team SSO is managed by owners and admins."
          />
        </SettingsCard>
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
