import { useMemo, useState } from "react";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import {
  buildCloudEnvironmentListItems,
} from "@proliferate/product-domain/environments/cloud-environments";
import { parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { CloudEnvironmentList } from "@proliferate/product-ui/environments/CloudEnvironmentList";
import { AddCloudEnvironmentDialogController } from "./cloud-environments/AddCloudEnvironmentDialogController";
import { CloudEnvironmentDetail } from "./cloud-environments/CloudEnvironmentDetail";

export interface CloudEnvironmentRepoSelection {
  gitOwner: string;
  gitRepoName: string;
}

export interface CloudEnvironmentsSettingsSurfaceProps {
  selectedCloudRepo?: CloudEnvironmentRepoSelection | null;
  organizationId?: string | null;
  canManageGitHubAppInstallation?: boolean;
  userAuthorizationReturnTo?: string | null;
  installationReturnTo?: string | null;
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  enabled?: boolean;
  cloudUnavailableReason?: string | null;
  onSelectCloudEnvironment: (repo: CloudEnvironmentRepoSelection) => void;
  onBackToList: () => void;
}

export function CloudEnvironmentsSettingsSurface({
  selectedCloudRepo = null,
  organizationId = null,
  canManageGitHubAppInstallation = false,
  userAuthorizationReturnTo = null,
  installationReturnTo = null,
  onOpenExternalUrl,
  enabled = true,
  cloudUnavailableReason = null,
  onSelectCloudEnvironment,
  onBackToList,
}: CloudEnvironmentsSettingsSurfaceProps) {
  const [addOpen, setAddOpen] = useState(false);
  const repoConfigs = useRepositories(enabled);
  const cloudEnvironmentConfigs = useMemo(
    () => (repoConfigs.data?.repositories ?? []).flatMap((repository) => {
      const cloudEnvironment = repository.environments.find((environment) =>
        environment.kind === "cloud"
      );
      if (!cloudEnvironment) {
        return [];
      }
      return [{
        gitOwner: repository.gitOwner,
        gitRepoName: repository.gitRepoName,
        materializationStatus: cloudEnvironment.materialization?.status ?? null,
      }];
    }),
    [repoConfigs.data?.repositories],
  );
  const cloudEnvironmentItems = useMemo(() => buildCloudEnvironmentListItems({
    configs: cloudEnvironmentConfigs,
  }), [cloudEnvironmentConfigs]);

  if (selectedCloudRepo && enabled) {
    return (
      <CloudEnvironmentDetail
        gitOwner={selectedCloudRepo.gitOwner}
        gitRepoName={selectedCloudRepo.gitRepoName}
        enabled={enabled}
        onBack={onBackToList}
        onSaved={() => {
          void repoConfigs.refetch();
        }}
      />
    );
  }

  return (
    <>
      <CloudEnvironmentList
        title="Environments"
        description="Personal Cloud environments are GitHub repositories Proliferate can run without a local clone."
        cloudEnvironments={cloudEnvironmentItems.map((environment) => ({
          id: environment.id,
          fullName: environment.fullName,
          description: environment.description,
          cloudStatus: environment.cloudStatus,
        }))}
        loadingCloudEnvironments={enabled && repoConfigs.isLoading}
        cloudUnavailableReason={cloudUnavailableReason}
        cloudErrorMessage={enabled && repoConfigs.isError
          ? "Cloud environments could not be loaded."
          : null}
        onSelectCloudEnvironment={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
        }}
        onAddCloudEnvironment={enabled ? () => setAddOpen(true) : undefined}
        onRetryCloudEnvironments={enabled && repoConfigs.isError
          ? () => {
              void repoConfigs.refetch();
            }
          : undefined}
      />
      <AddCloudEnvironmentDialogController
        open={addOpen}
        organizationId={organizationId}
        canManageGitHubAppInstallation={canManageGitHubAppInstallation}
        userAuthorizationReturnTo={userAuthorizationReturnTo}
        installationReturnTo={installationReturnTo}
        onOpenExternalUrl={onOpenExternalUrl}
        onClose={() => setAddOpen(false)}
        onEnvironmentAdded={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
          void repoConfigs.refetch();
        }}
      />
    </>
  );
}
