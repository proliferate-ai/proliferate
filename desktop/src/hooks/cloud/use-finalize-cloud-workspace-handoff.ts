import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  FinalizeCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/integrations/cloud/client";
import { finalizeCloudWorkspaceHandoff } from "@/lib/integrations/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "./query-keys";

export function useFinalizeCloudWorkspaceHandoff() {
  const queryClient = useQueryClient();

  return useMutation<
    CloudMobilityHandoffSummary,
    Error,
    {
      mobilityWorkspaceId: string;
      handoffOpId: string;
      input: FinalizeCloudWorkspaceMobilityHandoffRequest;
    }
  >({
    mutationFn: ({ mobilityWorkspaceId, handoffOpId, input }) =>
      finalizeCloudWorkspaceHandoff(mobilityWorkspaceId, handoffOpId, input),
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
