import { useQuery } from "@tanstack/react-query";
import type { CloudWorkspaceRepoConfigStatusResponse } from "@/lib/access/cloud/client";
import { getCloudWorkspaceRepoConfigStatus } from "@/lib/access/cloud/repo-configs";
import { cloudWorkspaceRepoConfigStatusKey } from "@/hooks/access/cloud/query-keys";

export function useCloudWorkspaceRepoConfigStatus(
  workspaceId: string | null | undefined,
  enabled = true,
) {
  const resolvedWorkspaceId = workspaceId?.trim() ?? "";

  return useQuery<CloudWorkspaceRepoConfigStatusResponse>({
    queryKey: cloudWorkspaceRepoConfigStatusKey(resolvedWorkspaceId),
    queryFn: () => getCloudWorkspaceRepoConfigStatus(resolvedWorkspaceId),
    enabled: enabled && resolvedWorkspaceId.length > 0,
    refetchInterval: (query) => {
      const phase = query.state.data?.postReadyPhase;
      return phase === "applying_files" || phase === "starting_setup" ? 2000 : false;
    },
  });
}
