import { useQuery } from "@tanstack/react-query";
import type { CloudRepoBranchesResponse } from "@/lib/access/cloud/client";
import { listCloudRepoBranches } from "@/lib/access/cloud/repos";
import { cloudRepoBranchesKey } from "./query-keys";

export function useCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
  enabled = true,
) {
  return useQuery<CloudRepoBranchesResponse>({
    queryKey: cloudRepoBranchesKey(gitOwner, gitRepoName),
    queryFn: () => listCloudRepoBranches(gitOwner, gitRepoName),
    enabled: enabled && gitOwner.trim().length > 0 && gitRepoName.trim().length > 0,
  });
}
