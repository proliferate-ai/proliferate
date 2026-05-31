import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudMobilityHandoffSummary } from "@/lib/access/cloud/client";
import { completeCloudWorkspaceHandoffCleanup } from "@proliferate/cloud-sdk/client/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { retryCloudWorkspaceRequest } from "@/lib/access/cloud/workspace-connection-retry";

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
      retryCloudWorkspaceRequest(
        () => completeCloudWorkspaceHandoffCleanup(mobilityWorkspaceId, handoffOpId),
        "Failed to finish workspace move cleanup.",
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
