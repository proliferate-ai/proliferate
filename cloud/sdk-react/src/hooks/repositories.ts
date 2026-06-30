import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listRepositories,
  saveRepoEnvironment,
  type RepoConfigsListResponse,
  type RepoEnvironmentResponse,
  type SaveRepoEnvironmentRequest,
} from "@proliferate/cloud-sdk";
import {
  cloudGitRepositoriesRootKey,
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
      void queryClient.invalidateQueries({ queryKey: repoConfigsKey() });
      void queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() });
    },
  });
}
