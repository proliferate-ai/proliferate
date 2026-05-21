import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimCloudWorkspace } from "@proliferate/cloud-sdk/client/claims";
import type { ClaimWorkspaceResponse } from "@proliferate/cloud-sdk/types";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useCloudWorkspaceClaimMutation() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useMutation<ClaimWorkspaceResponse, Error, string>({
    mutationFn: (workspaceId) => claimCloudWorkspace(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    },
  });
}
