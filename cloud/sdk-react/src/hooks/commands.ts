import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  enqueueCommand,
  getCommandStatus,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudCommandStatus,
} from "@proliferate/cloud-sdk";
import { cloudCommandKey, cloudWorkspaceSnapshotKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { invalidateCloudWorkspaceLists } from "./workspaces.js";

export function useCloudCommandStatus(commandId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudCommandResponse>({
    queryKey: cloudCommandKey(commandId),
    queryFn: () => getCommandStatus(commandId!, client),
    enabled: enabled && commandId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalCommandStatus(status) ? false : 1000;
    },
  });
}

export function useEnqueueCloudCommand<TPayload>() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudCommandResponse, Error, CloudCommandEnvelope<TPayload>>({
    mutationFn: (command) => enqueueCommand(command, client),
    onSuccess(result, command) {
      invalidateCloudWorkspaceLists(queryClient);
      const workspaceId = result.cloudWorkspaceId ?? command.cloudWorkspaceId ?? null;
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: cloudWorkspaceSnapshotKey(workspaceId),
        });
      }
    },
  });
}

function isTerminalCommandStatus(status: CloudCommandStatus): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}
