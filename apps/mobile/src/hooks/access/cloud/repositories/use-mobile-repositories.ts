import {
  useCloudGitRepositories,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";

export function useMobileGitRepositories(visible: boolean) {
  return useCloudGitRepositories({}, visible);
}

export function useSaveMobileRepoConfig() {
  return useSaveCloudRepoConfig();
}
