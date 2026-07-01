import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGitHubAppInstallationStatus,
  getGitHubAppUserAuthorizationStatus,
  getGitHubRepoAuthority,
  listGitHubAppAccessibleRepos,
  startGitHubAppInstallation,
  startGitHubAppUserAuthorization,
  type GitHubAppInstallationStartResponse,
  type GitHubAppInstallationStatusResponse,
  type GitHubAppUserAuthorizationStartResponse,
  type GitHubAppUserAuthorizationStatusResponse,
  type GitHubRepoAuthorityResponse,
  type ListGitHubAppAccessibleReposOptions,
  type StartGitHubAppInstallationOptions,
  type StartGitHubAppUserAuthorizationOptions,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  githubAppAccessibleReposKey,
  githubAppInstallationKey,
  githubAppRootKey,
  githubAppUserAuthorizationKey,
  githubRepoAuthorityKey,
} from "../lib/query-keys.js";

export function useGitHubAppUserAuthorizationStatus(
  enabled = true,
  authCacheScope = "default",
) {
  const client = useCloudClient();
  return useQuery<GitHubAppUserAuthorizationStatusResponse>({
    queryKey: githubAppUserAuthorizationKey(client.baseUrl, authCacheScope),
    queryFn: () => getGitHubAppUserAuthorizationStatus(client),
    enabled,
  });
}

export function useStartGitHubAppUserAuthorization() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    GitHubAppUserAuthorizationStartResponse,
    Error,
    StartGitHubAppUserAuthorizationOptions | void
  >({
    mutationFn: (options) => startGitHubAppUserAuthorization(options ?? {}, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: githubAppRootKey(client.baseUrl),
      });
    },
  });
}

export function useGitHubAppInstallationStatus(
  organizationId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<GitHubAppInstallationStatusResponse>({
    queryKey: githubAppInstallationKey(client.baseUrl, organizationId),
    queryFn: () => getGitHubAppInstallationStatus(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useStartGitHubAppInstallation() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    GitHubAppInstallationStartResponse,
    Error,
    { organizationId: string; options?: StartGitHubAppInstallationOptions }
  >({
    mutationFn: ({ organizationId, options }) =>
      startGitHubAppInstallation(organizationId, options ?? {}, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: githubAppRootKey(client.baseUrl),
      });
    },
  });
}

export function useGitHubRepoAuthority(
  input: {
    gitOwner: string | null | undefined;
    gitRepoName: string | null | undefined;
  },
  enabled = true,
) {
  const client = useCloudClient();
  const gitOwner = input.gitOwner?.trim() ?? "";
  const gitRepoName = input.gitRepoName?.trim() ?? "";
  return useQuery<GitHubRepoAuthorityResponse>({
    queryKey: githubRepoAuthorityKey(client.baseUrl, gitOwner, gitRepoName),
    queryFn: () => getGitHubRepoAuthority(gitOwner, gitRepoName, client),
    enabled: enabled && gitOwner.length > 0 && gitRepoName.length > 0,
  });
}

export function useValidateGitHubRepoAuthority() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    GitHubRepoAuthorityResponse,
    Error,
    { gitOwner: string; gitRepoName: string }
  >({
    mutationFn: ({ gitOwner, gitRepoName }) =>
      getGitHubRepoAuthority(gitOwner, gitRepoName, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(
        githubRepoAuthorityKey(client.baseUrl, gitOwner, gitRepoName),
        response,
      );
    },
  });
}

export function useGitHubAppAccessibleRepos(
  options: ListGitHubAppAccessibleReposOptions = {},
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery({
    queryKey: githubAppAccessibleReposKey(client.baseUrl, options),
    queryFn: () => listGitHubAppAccessibleRepos(options, client),
    enabled,
  });
}
