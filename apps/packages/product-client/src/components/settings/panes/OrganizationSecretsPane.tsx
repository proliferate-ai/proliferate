import { SecretManagementPanel } from "@proliferate/product-ui/secrets/SecretManagementPanel";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { useCloudSecretsPanel } from "#product/hooks/access/cloud/use-cloud-secrets-panel";
import { useIsAdmin } from "#product/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";

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
        <OrganizationSecretsPanel
          organizationId={activeOrganization.id}
          canManage={canManage}
        />
      ) : null}
    </section>
  );
}

function OrganizationSecretsPanel({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const panel = useCloudSecretsPanel({
    scope: { kind: "organization", organizationId, canManage },
  });

  return <SecretManagementPanel {...panel} />;
}
