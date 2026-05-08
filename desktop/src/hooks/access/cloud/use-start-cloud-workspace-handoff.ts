import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  StartCloudWorkspaceMobilityHandoffRequest,
} from "@/lib/access/cloud/client";
import { startCloudWorkspaceHandoff } from "@/lib/access/cloud/mobility";
import { applyCloudMobilityHandoffSummary } from "./mobility-cache";
import { autoSyncDetectedCloudCredentialsIfNeeded } from "@/lib/access/cloud/credential-recovery";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { useCloudCredentialMutations } from "./use-cloud-credential-mutations";

export function useStartCloudWorkspaceHandoff() {
  const queryClient = useQueryClient();
  const { syncCloudCredential } = useCloudCredentialMutations();

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
