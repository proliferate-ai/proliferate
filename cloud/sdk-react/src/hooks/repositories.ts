import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listRepositories,
  saveCloudRepoEnvironment,
  saveLocalRepoEnvironment,
  type RepoConfigsListResponse,
  type RepoEnvironmentResponse,
  type SaveCloudRepoEnvironmentRequest,
  type SaveLocalRepoEnvironmentRequest,
} from "@proliferate/cloud-sdk";
import {
  cloudGitRepositoriesRootKey,
  cloudRepoConfigKey,
  cloudRepoConfigsKey,
  repoConfigsKey,
  repoEnvironmentKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useRepoConfigs(enabled = true) {
  const client = useCloudClient();
  return useQuery<RepoConfigsListResponse>({
    queryKey: repoConfigsKey(),
    queryFn: () => listRepositories(client),
    enabled,
  });
}

export interface SaveCloudRepoEnvironmentInput {
  gitOwner: string;
  gitRepoName: string;
  body: SaveCloudRepoEnvironmentRequest;
}

export function useSaveCloudRepoEnvironment() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<RepoEnvironmentResponse, Error, SaveCloudRepoEnvironmentInput>({
    mutationFn: ({ gitOwner, gitRepoName, body }) =>
      saveCloudRepoEnvironment(gitOwner, gitRepoName, body, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(
        repoEnvironmentKey(gitOwner, gitRepoName, "cloud"),
        response,
      );
      void queryClient.invalidateQueries({ queryKey: repoConfigsKey() });
      void queryClient.invalidateQueries({ queryKey: cloudRepoConfigsKey() });
      void queryClient.invalidateQueries({ queryKey: cloudRepoConfigKey(gitOwner, gitRepoName) });
      void queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() });
    },
  });
}

export interface SaveLocalRepoEnvironmentInput {
  gitOwner: string;
  gitRepoName: string;
  body: SaveLocalRepoEnvironmentRequest;
}

export function useSaveLocalRepoEnvironment() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<RepoEnvironmentResponse, Error, SaveLocalRepoEnvironmentInput>({
    mutationFn: ({ gitOwner, gitRepoName, body }) =>
      saveLocalRepoEnvironment(gitOwner, gitRepoName, body, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(
        repoEnvironmentKey(
          gitOwner,
          gitRepoName,
          "local",
          response.desktopInstallId,
          response.localPath,
        ),
        response,
      );
      void queryClient.invalidateQueries({ queryKey: repoConfigsKey() });
      void queryClient.invalidateQueries({ queryKey: cloudRepoConfigsKey() });
    },
  });
}
