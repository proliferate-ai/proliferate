import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  listRepositories,
  removeCloudRepoEnvironment,
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
    onSuccess: async (response, { gitOwner, gitRepoName }) => {
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
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: repositoriesKey() }),
        queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() }),
        queryClient.invalidateQueries({ queryKey: githubAppRootKey(client.baseUrl) }),
      ];
      if (response.kind === "cloud") {
        invalidations.push(queryClient.invalidateQueries({
          queryKey: workspaceCloudSecretsKey(gitOwner, gitRepoName),
        }));
      }
      // Mutation completion is the ordering boundary used by setup-and-continue:
      // do not let workspace creation (or a retry) observe stale repository
      // configuration after the environment save has succeeded.
      await Promise.all(invalidations);
    },
  });
}

export interface RemoveCloudRepoEnvironmentInput {
  gitOwner: string;
  gitRepoName: string;
}

export function invalidateCloudRepoEnvironmentRemoval(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  clientBaseUrl: string,
  input: RemoveCloudRepoEnvironmentInput,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: repositoriesKey() }),
    queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() }),
    queryClient.invalidateQueries({ queryKey: githubAppRootKey(clientBaseUrl) }),
    queryClient.invalidateQueries({
      queryKey: workspaceCloudSecretsKey(input.gitOwner, input.gitRepoName),
    }),
  ]);
}

export function useRemoveCloudRepoEnvironment() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemoveCloudRepoEnvironmentInput>({
    mutationFn: ({ gitOwner, gitRepoName }) =>
      removeCloudRepoEnvironment(gitOwner, gitRepoName, client),
    onSuccess: (_, { gitOwner, gitRepoName }) => {
      queryClient.removeQueries({
        queryKey: repoEnvironmentKey(gitOwner, gitRepoName, "cloud"),
        exact: true,
      });
    },
    onSettled: (_, __, { gitOwner, gitRepoName }) => {
      return invalidateCloudRepoEnvironmentRemoval(queryClient, client.baseUrl, {
        gitOwner,
        gitRepoName,
      });
    },
  });
}
