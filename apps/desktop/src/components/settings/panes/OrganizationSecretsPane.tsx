import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
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
        <SettingsCard>
          <SettingsCardRow label="Organization secrets" description="Loading organization..." />
        </SettingsCard>
      ) : null}

      {!organizationsQuery.isLoading && !activeOrganization ? (
        <SettingsCard>
          <SettingsCardRow
            label="No organization"
            description="Create or join an organization before configuring organization-wide secrets."
          />
        </SettingsCard>
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
