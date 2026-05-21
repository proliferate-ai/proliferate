import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  claimCloudWorkspace,
  type ClaimWorkspaceRequest,
  type ClaimWorkspaceResponse,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspaceSnapshotKey,
  cloudWorkspacesKey,
  personalCloudOwnerKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useClaimCloudWorkspace() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ClaimWorkspaceResponse, Error, {
    workspaceId: string;
    body?: ClaimWorkspaceRequest;
  }>({
    mutationFn: ({ workspaceId, body }) => claimCloudWorkspace(workspaceId, body, client),
    onSuccess(_result, variables) {
      void queryClient.invalidateQueries({
        queryKey: cloudWorkspacesKey(personalCloudOwnerKey(), "exposed"),
      });
      void queryClient.invalidateQueries({
        queryKey: cloudWorkspaceSnapshotKey(variables.workspaceId),
      });
    },
  });
}
