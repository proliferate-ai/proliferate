import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
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
        <SettingsSection>
          <SettingsRow label="Organization secrets" description="Loading organization..." />
        </SettingsSection>
      ) : null}

      {!organization.currentTeamLoading && !currentTeam ? (
        <SettingsSection>
          <SettingsRow
            label="No organization"
            description="Create or join an organization before configuring organization-wide secrets."
          />
        </SettingsSection>
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
