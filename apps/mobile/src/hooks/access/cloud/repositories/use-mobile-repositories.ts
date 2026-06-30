import {
  useCloudGitRepositories,
  useSaveRepoEnvironment,
} from "@proliferate/cloud-sdk-react";

export function useMobileGitRepositories(visible: boolean) {
  return useCloudGitRepositories({}, visible);
}

export function useSaveMobileRepoConfig() {
  return useSaveRepoEnvironment();
}
