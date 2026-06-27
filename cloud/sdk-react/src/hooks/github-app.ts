import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createGitHubAppConnectUrl,
  getGitHubAppStatus,
  type GitHubAppConnectResponse,
  type GitHubAppStatusResponse,
  type GetGitHubAppStatusOptions,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { githubAppStatusKey, githubAppStatusRootKey } from "../lib/query-keys.js";

export function useGitHubAppStatus(
  options: GetGitHubAppStatusOptions = {},
  enabled = true,
  authCacheScope = "default",
) {
  const client = useCloudClient();
  return useQuery<GitHubAppStatusResponse>({
    queryKey: githubAppStatusKey(
      client.baseUrl,
      authCacheScope,
      options.gitOwner ?? null,
      options.gitRepoName ?? null,
    ),
    queryFn: () => getGitHubAppStatus(options, client),
    enabled,
  });
}

export function useCreateGitHubAppConnectUrl() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<GitHubAppConnectResponse, Error>({
    mutationFn: () => createGitHubAppConnectUrl(client),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: githubAppStatusRootKey(client.baseUrl),
      });
    },
  });
}
