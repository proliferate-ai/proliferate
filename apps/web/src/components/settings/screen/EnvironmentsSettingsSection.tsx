import { useState } from "react";
import {
  CloudEnvironmentsSettingsSurface,
  type CloudEnvironmentRepoSelection,
} from "@proliferate/product-surfaces/settings/CloudEnvironmentsSettingsSurface";

export function EnvironmentsSettingsSection() {
  const [selectedCloudRepo, setSelectedCloudRepo] =
    useState<CloudEnvironmentRepoSelection | null>(null);

  return (
    <CloudEnvironmentsSettingsSurface
      mode="cloud-only"
      selectedCloudRepo={selectedCloudRepo}
      onSelectCloudEnvironment={setSelectedCloudRepo}
      onBackToList={() => setSelectedCloudRepo(null)}
    />
  );
}
