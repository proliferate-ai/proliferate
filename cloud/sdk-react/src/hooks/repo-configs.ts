import { useQuery } from "@tanstack/react-query";
import {
  listCloudRepoConfigs,
  type CloudRepoConfigsListResponse,
} from "@proliferate/cloud-sdk";
import { cloudRepoConfigsKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudRepoConfigs(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudRepoConfigsListResponse>({
    queryKey: cloudRepoConfigsKey(),
    queryFn: () => listCloudRepoConfigs(client),
    enabled,
  });
}
