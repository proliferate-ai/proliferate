import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  StartCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/integrations/cloud/client";
import { startCloudWorkspaceHandoff } from "@/lib/integrations/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { autoSyncDetectedCloudCredentialsIfNeeded } from "./cloud-credential-recovery";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "./query-keys";
import { useCloudCredentialActions } from "./use-cloud-credential-actions";

export function useStartCloudWorkspaceHandoff() {
  const queryClient = useQueryClient();
  const { syncCloudCredential } = useCloudCredentialActions();

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
        const didSync = await autoSyncDetectedCloudCredentialsIfNeeded(
          error,
          syncCloudCredential,
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
