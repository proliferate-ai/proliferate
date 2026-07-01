import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  claimCloudWorkspace,
  type ClaimWorkspaceRequest,
  type ClaimWorkspaceResponse,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspaceKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { invalidateCloudWorkspaceLists } from "./workspaces.js";

export function useClaimCloudWorkspace() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ClaimWorkspaceResponse, Error, {
    workspaceId: string;
    body?: ClaimWorkspaceRequest;
  }>({
    mutationFn: ({ workspaceId, body }) => claimCloudWorkspace(workspaceId, body, client),
    onSuccess(_result, variables) {
      invalidateCloudWorkspaceLists(queryClient);
      void queryClient.invalidateQueries({
        queryKey: cloudWorkspaceKey(variables.workspaceId),
      });
    },
  });
}
