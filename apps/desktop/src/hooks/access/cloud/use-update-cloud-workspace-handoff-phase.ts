import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  UpdateCloudWorkspaceMobilityHandoffPhaseRequest,
} from "@/lib/access/cloud/client";
import { updateCloudWorkspaceHandoffPhase } from "@proliferate/cloud-sdk/client/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { retryCloudWorkspaceRequest } from "@/lib/access/cloud/workspace-connection-retry";

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
      retryCloudWorkspaceRequest(
        () => updateCloudWorkspaceHandoffPhase(mobilityWorkspaceId, handoffOpId, input),
        "Failed to update workspace move progress.",
      ),
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
      ]).catch(() => undefined);
    },
  });
}
