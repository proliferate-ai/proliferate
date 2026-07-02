import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

export function PersonalSecretsPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Personal secrets"
        description="Secrets available in your personal cloud sandbox"
      />

      <CloudSecretsSettingsSurface scope={{ kind: "personal" }} />
    </section>
  );
}
