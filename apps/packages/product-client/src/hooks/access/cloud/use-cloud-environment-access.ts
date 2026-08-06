import {
  useGitHubRepoAuthority,
  useRepositories,
  useSaveRepoEnvironment,
  useValidateCloudRepoBranches,
  useValidateGitHubRepoAuthority,
} from "@proliferate/cloud-sdk-react";

export interface CloudEnvironmentAccessInput {
  repositoryConfigsEnabled?: boolean;
  authCacheScope?: string;
  repository?: {
    gitOwner: string | null | undefined;
    gitRepoName: string | null | undefined;
  } | null;
  authorityEnabled?: boolean;
}

/** Cloud SDK React ownership for repository configuration and environment mutations. */
export function useCloudEnvironmentAccess({
  repositoryConfigsEnabled = false,
  authCacheScope,
  repository = null,
  authorityEnabled = false,
}: CloudEnvironmentAccessInput = {}) {
  const repositoryConfigs = useRepositories(repositoryConfigsEnabled, authCacheScope);
  const authority = useGitHubRepoAuthority(
    {
      gitOwner: repository?.gitOwner,
      gitRepoName: repository?.gitRepoName,
    },
    authorityEnabled,
  );
  const validateAuthority = useValidateGitHubRepoAuthority();
  const validateBranches = useValidateCloudRepoBranches();
  const saveEnvironment = useSaveRepoEnvironment();

  return {
    repositoryConfigs,
    authority,
    validateAuthority,
    validateBranches,
    saveEnvironment,
  };
}
