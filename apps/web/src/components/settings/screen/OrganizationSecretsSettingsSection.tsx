import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";

import { useWebOrganizationSettings } from "../../../hooks/settings/facade/use-web-organization-settings";

export function OrganizationSecretsSettingsSection() {
  const organization = useWebOrganizationSettings();
  const currentTeam = organization.currentTeam;
  const canManage = currentTeam?.membership?.status === "active"
    && (currentTeam.membership.role === "owner" || currentTeam.membership.role === "admin");

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization secrets"
        description="Manage secrets available in every member's cloud sandbox."
      />

      {organization.currentTeamLoading ? (
        <SettingsCard>
          <SettingsCardRow label="Organization secrets" description="Loading organization..." />
        </SettingsCard>
      ) : null}

      {!organization.currentTeamLoading && !currentTeam ? (
        <SettingsCard>
          <SettingsCardRow
            label="No organization"
            description="Create or join an organization before configuring organization-wide secrets."
          />
        </SettingsCard>
      ) : null}

      {currentTeam ? (
        <CloudSecretsSettingsSurface
          scope={{
            kind: "organization",
            organizationId: currentTeam.id,
            canManage,
          }}
        />
      ) : null}
    </section>
  );
}
