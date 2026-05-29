import { useQuery } from "@tanstack/react-query";
import {
  getCloudRepoConfig,
  getOrganizationCloudRepoConfig,
} from "@proliferate/cloud-sdk/client/repo-configs";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import {
  cloudRepoConfigKey,
  organizationCloudRepoConfigKey,
} from "./query-keys";

export function useCloudRepoConfig(
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
  enabled = true,
) {
  const resolvedGitOwner = gitOwner?.trim() ?? "";
  const resolvedGitRepoName = gitRepoName?.trim() ?? "";

  return useQuery<CloudRepoConfig>({
    queryKey: cloudRepoConfigKey(resolvedGitOwner, resolvedGitRepoName),
    queryFn: () => getCloudRepoConfig(resolvedGitOwner, resolvedGitRepoName),
    enabled: enabled && resolvedGitOwner.length > 0 && resolvedGitRepoName.length > 0,
  });
}

export function useOrganizationCloudRepoConfig(
  organizationId: string | null | undefined,
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
  enabled = true,
) {
  const resolvedOrganizationId = organizationId?.trim() ?? "";
  const resolvedGitOwner = gitOwner?.trim() ?? "";
  const resolvedGitRepoName = gitRepoName?.trim() ?? "";

  return useQuery<CloudRepoConfig>({
    queryKey: organizationCloudRepoConfigKey(
      resolvedOrganizationId || null,
      resolvedGitOwner,
      resolvedGitRepoName,
    ),
    queryFn: () => getOrganizationCloudRepoConfig(
      resolvedOrganizationId,
      resolvedGitOwner,
      resolvedGitRepoName,
    ),
    enabled: enabled
      && resolvedOrganizationId.length > 0
      && resolvedGitOwner.length > 0
      && resolvedGitRepoName.length > 0,
  });
}
