import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

export function PersonalSecretsPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Personal secrets"
        description="Manage secrets available in your personal cloud sandbox."
      />

      <CloudSecretsSettingsSurface scope={{ kind: "personal" }} />
    </section>
  );
}
