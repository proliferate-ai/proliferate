import { useMutation } from "@tanstack/react-query";
import type { CloudMobilityHandoffSummary } from "@/lib/access/cloud/client";
import { heartbeatCloudWorkspaceHandoff } from "@/lib/access/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { useQueryClient } from "@tanstack/react-query";

export function useCloudWorkspaceHandoffHeartbeatMutation() {
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
      heartbeatCloudWorkspaceHandoff(mobilityWorkspaceId, handoffOpId),
    onSuccess: (handoff, variables) => {
      applyCloudMobilityHandoffSummary(
        queryClient,
        variables.mobilityWorkspaceId,
        handoff,
      );
    },
  });
}
