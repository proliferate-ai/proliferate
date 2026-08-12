import { SecretManagementPanel } from "#product/components/patterns/secrets/SecretManagementPanel";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
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
    <SettingsPageBody>
      <PageHeader
        variant="flat"
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
    </SettingsPageBody>
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
