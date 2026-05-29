import { useQuery } from "@tanstack/react-query";
import {
  listCloudRepoConfigs,
  listOrganizationCloudRepoConfigs,
} from "@proliferate/cloud-sdk/client/repo-configs";
import type { CloudRepoConfigsList } from "@/lib/domain/cloud/repo-configs";
import {
  cloudRepoConfigsKey,
  organizationCloudRepoConfigsKey,
} from "./query-keys";

export function useCloudRepoConfigs(enabled = true) {
  return useQuery<CloudRepoConfigsList>({
    queryKey: cloudRepoConfigsKey(),
    queryFn: () => listCloudRepoConfigs(),
    enabled,
  });
}

export function useOrganizationCloudRepoConfigs(
  organizationId: string | null | undefined,
  enabled = true,
) {
  const resolvedOrganizationId = organizationId?.trim() ?? "";
  return useQuery<CloudRepoConfigsList>({
    queryKey: organizationCloudRepoConfigsKey(resolvedOrganizationId || null),
    queryFn: () => listOrganizationCloudRepoConfigs(resolvedOrganizationId),
    enabled: enabled && resolvedOrganizationId.length > 0,
  });
}
