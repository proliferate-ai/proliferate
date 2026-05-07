import { useQuery } from "@tanstack/react-query";
import type { CloudRepoConfigsListResponse } from "@/lib/access/cloud/client";
import { listCloudRepoConfigs } from "@/lib/access/cloud/repo-configs";
import { cloudRepoConfigsKey } from "./query-keys";

export function useCloudRepoConfigs(enabled = true) {
  return useQuery<CloudRepoConfigsListResponse>({
    queryKey: cloudRepoConfigsKey(),
    queryFn: () => listCloudRepoConfigs(),
    enabled,
  });
}
