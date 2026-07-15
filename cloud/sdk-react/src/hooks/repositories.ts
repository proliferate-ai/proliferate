import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listRepositories,
  saveRepoEnvironment,
  updateRepoConfig,
  type RepoConfigResponse,
  type RepoConfigsListResponse,
  type RepoEnvironmentResponse,
  type SaveRepoEnvironmentRequest,
  type UpdateRepoConfigRequest,
} from "@proliferate/cloud-sdk";
import {
  actorRepositoriesKey,
  cloudGitRepositoriesRootKey,
  repositoriesKey,
  githubAppRootKey,
  repoEnvironmentKey,
  workspaceCloudSecretsKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useRepositories(enabled = true, authCacheScope?: string) {
  const client = useCloudClient();
  return useQuery<RepoConfigsListResponse>({
    queryKey: authCacheScope
      ? actorRepositoriesKey(client.baseUrl, authCacheScope)
      : repositoriesKey(),
    queryFn: () => listRepositories(client),
    enabled,
  });
}

export interface UpdateRepoConfigInput {
  gitOwner: string;
  gitRepoName: string;
  body: UpdateRepoConfigRequest;
}

export function useUpdateRepoConfig() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<RepoConfigResponse, Error, UpdateRepoConfigInput>({
    mutationFn: ({ gitOwner, gitRepoName, body }) =>
      updateRepoConfig(gitOwner, gitRepoName, body, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repositoriesKey() });
    },
  });
}

export interface SaveRepoEnvironmentInput {
  gitOwner: string;
  gitRepoName: string;
  body: SaveRepoEnvironmentRequest;
}

export function useSaveRepoEnvironment() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<RepoEnvironmentResponse, Error, SaveRepoEnvironmentInput>({
    mutationFn: ({ gitOwner, gitRepoName, body }) =>
      saveRepoEnvironment(gitOwner, gitRepoName, body, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      if (response.kind === "local") {
        queryClient.setQueryData(
          repoEnvironmentKey(
            gitOwner,
            gitRepoName,
            "local",
            response.desktopInstallId ?? null,
            response.localPath ?? null,
          ),
          response,
        );
      } else {
        queryClient.setQueryData(
          repoEnvironmentKey(gitOwner, gitRepoName, "cloud"),
          response,
        );
      }
      void queryClient.invalidateQueries({ queryKey: repositoriesKey() });
      void queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() });
      void queryClient.invalidateQueries({ queryKey: githubAppRootKey(client.baseUrl) });
      if (response.kind === "cloud") {
        void queryClient.invalidateQueries({
          queryKey: workspaceCloudSecretsKey(gitOwner, gitRepoName),
        });
      }
    },
  });
}
