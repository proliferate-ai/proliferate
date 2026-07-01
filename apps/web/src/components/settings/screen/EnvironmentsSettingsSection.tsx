import { useState } from "react";
import {
  CloudEnvironmentsSettingsSurface,
  type CloudEnvironmentRepoSelection,
} from "@proliferate/product-surfaces/settings/CloudEnvironmentsSettingsSurface";
import { useCurrentTeam } from "@proliferate/cloud-sdk-react";

export function EnvironmentsSettingsSection() {
  const [selectedCloudRepo, setSelectedCloudRepo] =
    useState<CloudEnvironmentRepoSelection | null>(null);
  const currentTeam = useCurrentTeam();
  const team = currentTeam.data ?? null;
  const teamRole = team?.membership?.role ?? null;
  const canManageGitHubAppInstallation = team?.membership?.status === "active"
    && (teamRole === "owner" || teamRole === "admin");

  return (
    <CloudEnvironmentsSettingsSurface
      mode="cloud-only"
      selectedCloudRepo={selectedCloudRepo}
      organizationId={team?.id ?? null}
      canManageGitHubAppInstallation={canManageGitHubAppInstallation}
      userAuthorizationReturnTo={`${window.location.origin}/settings/environments?source=github_app_callback`}
      installationReturnTo={`${window.location.origin}/settings/environments?source=github_app_installation_callback`}
      onOpenExternalUrl={(url) => {
        window.location.assign(url);
      }}
      onSelectCloudEnvironment={setSelectedCloudRepo}
      onBackToList={() => setSelectedCloudRepo(null)}
    />
  );
}
