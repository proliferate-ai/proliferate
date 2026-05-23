import { useMutation, useQuery } from "@tanstack/react-query";
import {
  enqueueCommand,
  getCommandStatus,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudCommandStatus,
} from "@proliferate/cloud-sdk";
import { cloudCommandKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

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
  return useMutation<CloudCommandResponse, Error, CloudCommandEnvelope<TPayload>>({
    mutationFn: (command) => enqueueCommand(command, client),
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
