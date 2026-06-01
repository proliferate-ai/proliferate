import { useCallback } from "react";
import { useCloudWorkspaceClaimMutation } from "@/hooks/access/cloud/use-cloud-workspace-claim-mutation";
import { useStartCloudWorkspaceMutation } from "@/hooks/access/cloud/workspaces/use-start-cloud-workspace-mutation";

interface UseSelectedCloudRuntimeActionsInput {
  cloudWorkspaceId: string | null;
  canUseConnection: boolean;
  connectionFailed: boolean;
  needsClaim: boolean;
  refetchConnection: () => Promise<unknown>;
}

export function useSelectedCloudRuntimeActions({
  cloudWorkspaceId,
  canUseConnection,
  connectionFailed,
  needsClaim,
  refetchConnection,
}: UseSelectedCloudRuntimeActionsInput) {
  const startMutation = useStartCloudWorkspaceMutation({
    telemetryAction: "start_selected_cloud_runtime",
  });
  const claimMutation = useCloudWorkspaceClaimMutation();
  const { mutateAsync: startCloudWorkspace, isPending: startPending } = startMutation;
  const { mutate: claimCloudWorkspace, isPending: claimPending } = claimMutation;

  const retry = useCallback(() => {
    if (
      connectionFailed
      && cloudWorkspaceId
      && !startPending
    ) {
      void startCloudWorkspace(cloudWorkspaceId)
        .then(() => refetchConnection())
        .catch(() => undefined);
      return;
    }
    void refetchConnection();
  }, [
    cloudWorkspaceId,
    connectionFailed,
    refetchConnection,
    startCloudWorkspace,
    startPending,
  ]);

  const claim = useCallback(() => {
    if (!cloudWorkspaceId) {
      return;
    }
    claimCloudWorkspace(cloudWorkspaceId);
  }, [claimCloudWorkspace, cloudWorkspaceId]);

  return {
    retry: canUseConnection ? retry : null,
    claim: cloudWorkspaceId && needsClaim ? claim : null,
    claimPending,
  };
}
