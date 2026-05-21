import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  StartCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/access/cloud/client";
import { startCloudWorkspaceHandoff } from "@proliferate/cloud-sdk/client/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { autoSyncDetectedAgentAuthCredentialsIfNeeded } from "@/lib/access/cloud/agent-auth-recovery";
import { syncLocalAgentAuthCredentialToCloud } from "@/lib/access/cloud/agent-auth-sync";
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
      try {
        return await startCloudWorkspaceHandoff(mobilityWorkspaceId, input);
      } catch (error) {
        const didSync = await autoSyncDetectedAgentAuthCredentialsIfNeeded(
          error,
          syncLocalAgentAuthCredentialToCloud,
        );
        if (!didSync) {
          throw error;
        }
        return await startCloudWorkspaceHandoff(mobilityWorkspaceId, input);
      }
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
      ]);
    },
  });
}
