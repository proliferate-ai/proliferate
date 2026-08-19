import { SecretManagementPanel } from "#product/components/patterns/secrets/SecretManagementPanel";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { useCloudSecretsPanel } from "#product/hooks/access/cloud/use-cloud-secrets-panel";

const PERSONAL_SCOPE = { kind: "personal" } as const;

export function PersonalSecretsPane() {
  const panel = useCloudSecretsPanel({ scope: PERSONAL_SCOPE });

  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
        title="Personal secrets"
        description="Secrets available in your personal cloud sandbox"
      />

      <SecretManagementPanel {...panel} />
    </SettingsPageBody>
  );
}
