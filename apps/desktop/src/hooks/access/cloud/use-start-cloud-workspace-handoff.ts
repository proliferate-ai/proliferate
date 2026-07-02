import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  StartCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/access/cloud/client";
import { startCloudWorkspaceHandoff } from "@proliferate/cloud-sdk/client/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";

export function useStartCloudWorkspaceHandoff() {
  const queryClient = useQueryClient();

  return useMutation<
    CloudMobilityHandoffSummary,
    Error,
    {
      mobilityWorkspaceId: string;
      input: StartCloudWorkspaceMobilityHandoffRequest;
    }
  >({
    mutationFn: async ({ mobilityWorkspaceId, input }) => {
      return startCloudWorkspaceHandoff(mobilityWorkspaceId, input);
    },
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
