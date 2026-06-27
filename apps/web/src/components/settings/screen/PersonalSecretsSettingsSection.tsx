import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";

import { useWebAccountSettingsActions } from "../../../hooks/settings/workflows/use-web-account-settings-actions";

export function PersonalSecretsSettingsSection() {
  const account = useWebAccountSettingsActions();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Personal secrets"
        description="Manage secrets available in your personal cloud sandbox."
      />
      <CloudSecretsSettingsSurface scope={{ kind: "personal" }} enabled={Boolean(account.viewer)} />
    </section>
  );
}
