import { useQuery } from "@tanstack/react-query";
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";
import { getCloudRepoConfig } from "@/lib/integrations/cloud/repo-configs";
import { cloudRepoConfigKey } from "./query-keys";

export function useCloudRepoConfig(
  gitOwner: string | null | undefined,
  gitRepoName: string | null | undefined,
  enabled = true,
) {
  const resolvedGitOwner = gitOwner?.trim() ?? "";
  const resolvedGitRepoName = gitRepoName?.trim() ?? "";

  return useQuery<CloudRepoConfigResponse>({
    queryKey: cloudRepoConfigKey(resolvedGitOwner, resolvedGitRepoName),
    queryFn: () => getCloudRepoConfig(resolvedGitOwner, resolvedGitRepoName),
    enabled: enabled && resolvedGitOwner.length > 0 && resolvedGitRepoName.length > 0,
  });
}
