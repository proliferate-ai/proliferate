import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  UpdateCloudWorkspaceMobilityHandoffPhaseRequest,
} from "@/lib/access/cloud/client";
import { updateCloudWorkspaceHandoffPhase } from "@/lib/access/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";

export function useUpdateCloudWorkspaceHandoffPhase() {
  const queryClient = useQueryClient();

  return useMutation<
    CloudMobilityHandoffSummary,
    Error,
    {
      mobilityWorkspaceId: string;
      handoffOpId: string;
      input: UpdateCloudWorkspaceMobilityHandoffPhaseRequest;
    }
  >({
    mutationFn: ({ mobilityWorkspaceId, handoffOpId, input }) =>
      updateCloudWorkspaceHandoffPhase(mobilityWorkspaceId, handoffOpId, input),
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
