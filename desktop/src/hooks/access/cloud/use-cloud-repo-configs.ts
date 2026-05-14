import { useQuery } from "@tanstack/react-query";
import { listCloudRepoConfigs } from "@proliferate/cloud-sdk/client/repo-configs";
import type { CloudRepoConfigsList } from "@/lib/domain/cloud/repo-configs";
import { cloudRepoConfigsKey } from "./query-keys";

export function useCloudRepoConfigs(enabled = true) {
  return useQuery<CloudRepoConfigsList>({
    queryKey: cloudRepoConfigsKey(),
    queryFn: () => listCloudRepoConfigs(),
    enabled,
  });
}
