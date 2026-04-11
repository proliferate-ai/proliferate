import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  FailCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/integrations/cloud/client";
import { failCloudWorkspaceHandoff } from "@/lib/integrations/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "./query-keys";

export function useFailCloudWorkspaceHandoff() {
  const queryClient = useQueryClient();

  return useMutation<
    CloudMobilityHandoffSummary,
    Error,
    {
      mobilityWorkspaceId: string;
      handoffOpId: string;
      input: FailCloudWorkspaceMobilityHandoffRequest;
    }
  >({
    mutationFn: ({ mobilityWorkspaceId, handoffOpId, input }) =>
      failCloudWorkspaceHandoff(mobilityWorkspaceId, handoffOpId, input),
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
