import { useQuery } from "@tanstack/react-query";
import type { CloudRepoBranchesResponse } from "@/lib/access/cloud/client";
import { listCloudRepoBranches } from "@proliferate/cloud-sdk/client/repos";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudRepoBranchesKey } from "./query-keys";

export function useCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
  enabled = true,
) {
  const cloudClient = useProductHost().cloud.client;
  return useQuery<CloudRepoBranchesResponse>({
    queryKey: cloudRepoBranchesKey(gitOwner, gitRepoName),
    queryFn: () => listCloudRepoBranches(gitOwner, gitRepoName, cloudClient!),
    enabled:
      enabled
      && cloudClient !== null
      && gitOwner.trim().length > 0
      && gitRepoName.trim().length > 0,
  });
}
