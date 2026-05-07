import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudMobilityHandoffSummary } from "@/lib/access/cloud/client";
import { completeCloudWorkspaceHandoffCleanup } from "@/lib/access/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";

export function useCompleteCloudWorkspaceHandoffCleanup() {
  const queryClient = useQueryClient();

  return useMutation<
    CloudMobilityHandoffSummary,
    Error,
    {
      mobilityWorkspaceId: string;
      handoffOpId: string;
    }
  >({
    mutationFn: ({ mobilityWorkspaceId, handoffOpId }) =>
      completeCloudWorkspaceHandoffCleanup(mobilityWorkspaceId, handoffOpId),
    onSuccess: async (handoff, variables) => {
      applyCloudMobilityHandoffSummary(
        queryClient,
        variables.mobilityWorkspaceId,
        handoff,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: cloudMobilityWorkspaceKey(variables.mobilityWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: cloudMobilityWorkspacesKey(),
        }),
      ]);
    },
  });
}
