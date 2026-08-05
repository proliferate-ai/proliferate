import {
  useGitHubAppAccessibleRepos,
  useGitHubAppInstallationStatus,
  useGitHubAppUserAuthorizationStatus,
  useStartGitHubAppInstallation,
  useStartGitHubAppUserAuthorization,
} from "@proliferate/cloud-sdk-react";

export interface GitHubRepositoryPickerAccessInput {
  enabled: boolean;
  organizationId: string | null;
  query: string | null;
  cursor: string | null;
  limit: number;
}

/** Cloud SDK React ownership for GitHub authorization, installation, and catalog access. */
export function useGitHubRepositoryPickerAccess({
  enabled,
  organizationId,
  query,
  cursor,
  limit,
}: GitHubRepositoryPickerAccessInput) {
  const userAuthorization = useGitHubAppUserAuthorizationStatus(enabled);
  const startUserAuthorization = useStartGitHubAppUserAuthorization();
  const installation = useGitHubAppInstallationStatus(
    organizationId,
    enabled && organizationId !== null,
  );
  const startInstallation = useStartGitHubAppInstallation();
  const prerequisitesReady = userAuthorization.data?.connected === true
    && installation.data?.installed === true;
  const catalog = useGitHubAppAccessibleRepos(
    { query, cursor, limit },
    enabled && prerequisitesReady,
  );

  return {
    userAuthorization,
    startUserAuthorization,
    installation,
    startInstallation,
    catalog,
  };
}
