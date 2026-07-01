import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsSection } from "@/components/settings/shared/SettingsSection";
import { SettingsRow } from "@/components/settings/shared/SettingsRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";

export function OrganizationSecretsPane() {
  const {
    activeOrganization,
    activeOrganizationId,
    organizationsQuery,
  } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canManage = admin.isAdmin === true;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization secrets"
        description="Manage secrets available in every member's cloud sandbox."
      />

      {organizationsQuery.isLoading ? (
        <SettingsSection>
          <SettingsRow label="Organization secrets" description="Loading organization..." />
        </SettingsSection>
      ) : null}

      {!organizationsQuery.isLoading && !activeOrganization ? (
        <SettingsSection>
          <SettingsRow
            label="No organization"
            description="Create or join an organization before configuring organization-wide secrets."
          />
        </SettingsSection>
      ) : null}

      {activeOrganization ? (
        <CloudSecretsSettingsSurface
          scope={{
            kind: "organization",
            organizationId: activeOrganization.id,
            canManage,
          }}
        />
      ) : null}
    </section>
  );
}
