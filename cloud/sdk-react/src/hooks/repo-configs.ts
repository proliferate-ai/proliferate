import { useQuery } from "@tanstack/react-query";
import {
  listCloudRepoConfigs,
  listOrganizationCloudRepoConfigs,
  type CloudRepoConfigsListResponse,
} from "@proliferate/cloud-sdk";
import {
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
