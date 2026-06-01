import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimCloudWorkspace } from "@proliferate/cloud-sdk/client/claims";
import type { ClaimWorkspaceResponse } from "@proliferate/cloud-sdk/types";
import { cloudBillingKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useCloudWorkspaceClaimMutation() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useMutation<ClaimWorkspaceResponse, Error, string>({
    mutationFn: (workspaceId) => claimCloudWorkspace(workspaceId),
    onSuccess: async (_response, workspaceId) => {
      await Promise.all([
        clearCachedCloudConnections(queryClient, workspaceId),
        queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: cloudBillingKey(),
        }),
      ]);
    },
  });
}
