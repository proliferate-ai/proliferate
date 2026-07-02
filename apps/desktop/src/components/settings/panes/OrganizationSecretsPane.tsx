import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
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
        description="Secrets available in every member's cloud sandbox"
      />

      {organizationsQuery.isLoading ? (
        <div className="text-ui-sm text-muted-foreground">Loading organization…</div>
      ) : null}

      {!organizationsQuery.isLoading && !activeOrganization ? (
        <SettingsEmptyState
          size="compact"
          title="No organization yet"
          description="Create or join an organization to configure organization-wide secrets."
        />
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
