import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCloudRepoConfig,
  listCloudRepoConfigs,
  listOrganizationCloudRepoConfigs,
  saveCloudRepoConfig,
  type CloudRepoConfigResponse,
  type CloudRepoConfigsListResponse,
  type SaveCloudRepoConfigRequest,
} from "@proliferate/cloud-sdk";
import {
  cloudGitRepositoriesRootKey,
  cloudRepoConfigKey,
  cloudRepoConfigsKey,
  organizationCloudRepoConfigsKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudRepoConfigs(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudRepoConfigsListResponse>({
    queryKey: cloudRepoConfigsKey(),
    queryFn: () => listCloudRepoConfigs(client),
    enabled,
  });
}

export function useCloudRepoConfig(
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
  enabled = true,
) {
  const client = useCloudClient();
  const resolvedGitOwner = gitOwner?.trim() ?? "";
  const resolvedGitRepoName = gitRepoName?.trim() ?? "";
  return useQuery<CloudRepoConfigResponse>({
    queryKey: cloudRepoConfigKey(resolvedGitOwner, resolvedGitRepoName),
    queryFn: () => getCloudRepoConfig(resolvedGitOwner, resolvedGitRepoName, client),
    enabled: enabled && resolvedGitOwner.length > 0 && resolvedGitRepoName.length > 0,
  });
}

export interface LoadCloudRepoConfigInput {
  gitOwner: string;
  gitRepoName: string;
}

export function useLoadCloudRepoConfig() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudRepoConfigResponse, Error, LoadCloudRepoConfigInput>({
    mutationFn: ({ gitOwner, gitRepoName }) =>
      getCloudRepoConfig(gitOwner, gitRepoName, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(cloudRepoConfigKey(gitOwner, gitRepoName), response);
    },
  });
}

export interface SaveCloudRepoConfigInput {
  gitOwner: string;
  gitRepoName: string;
  body: SaveCloudRepoConfigRequest;
}

export function useSaveCloudRepoConfig() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudRepoConfigResponse, Error, SaveCloudRepoConfigInput>({
    mutationFn: ({ gitOwner, gitRepoName, body }) =>
      saveCloudRepoConfig(gitOwner, gitRepoName, body, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(cloudRepoConfigKey(gitOwner, gitRepoName), response);
      void queryClient.invalidateQueries({ queryKey: cloudRepoConfigsKey() });
      void queryClient.invalidateQueries({ queryKey: cloudGitRepositoriesRootKey() });
    },
  });
}

export function useOrganizationCloudRepoConfigs(
  organizationId: string | null | undefined,
  enabled = true,
) {
  const client = useCloudClient();
  const resolvedOrganizationId = organizationId?.trim() ?? "";
  return useQuery<CloudRepoConfigsListResponse>({
    queryKey: organizationCloudRepoConfigsKey(resolvedOrganizationId || null),
    queryFn: () => listOrganizationCloudRepoConfigs(resolvedOrganizationId, client),
    enabled: enabled && resolvedOrganizationId.length > 0,
  });
}
