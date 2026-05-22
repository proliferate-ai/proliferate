import { useMutation } from "@tanstack/react-query";
import { claimCloudWorkspace } from "@proliferate/cloud-sdk/client/claims";

export function useCloudWorkspaceClaimMutation() {
  return useMutation({
    mutationFn: (workspaceId: string) =>
      claimCloudWorkspace(workspaceId, { sourceKind: "manual" }),
  });
}
