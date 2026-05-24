import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listCloudGitRepositories,
  listCloudRepoBranches,
  type CloudGitRepositoriesResponse,
  type CloudRepoBranchesResponse,
  type ListCloudGitRepositoriesOptions,
} from "@proliferate/cloud-sdk";

import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudGitRepositoriesKey,
  cloudRepoBranchesKey,
} from "../lib/query-keys.js";

export function useCloudGitRepositories(
  options: ListCloudGitRepositoriesOptions = {},
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<CloudGitRepositoriesResponse>({
    queryKey: cloudGitRepositoriesKey(options),
    queryFn: () => listCloudGitRepositories(options, client),
    enabled,
  });
}

export function useCloudRepoBranches(
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
  enabled = true,
) {
  const client = useCloudClient();
  const resolvedGitOwner = gitOwner?.trim() ?? "";
  const resolvedGitRepoName = gitRepoName?.trim() ?? "";
  return useQuery<CloudRepoBranchesResponse>({
    queryKey: cloudRepoBranchesKey(resolvedGitOwner, resolvedGitRepoName),
    queryFn: () => listCloudRepoBranches(resolvedGitOwner, resolvedGitRepoName, client),
    enabled: enabled && resolvedGitOwner.length > 0 && resolvedGitRepoName.length > 0,
  });
}

export interface ValidateCloudRepoBranchesInput {
  gitOwner: string;
  gitRepoName: string;
}

export function useValidateCloudRepoBranches() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudRepoBranchesResponse, Error, ValidateCloudRepoBranchesInput>({
    mutationFn: ({ gitOwner, gitRepoName }) =>
      listCloudRepoBranches(gitOwner, gitRepoName, client),
    onSuccess: (response, { gitOwner, gitRepoName }) => {
      queryClient.setQueryData(cloudRepoBranchesKey(gitOwner, gitRepoName), response);
    },
  });
}
