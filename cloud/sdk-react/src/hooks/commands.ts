import { useMutation, useQuery } from "@tanstack/react-query";
import {
  enqueueCommand,
  getCommandStatus,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
} from "@proliferate/cloud-sdk";
import { cloudCommandKey } from "../lib/query-keys";

export function useCloudCommandStatus(commandId: string | null, enabled = true) {
  return useQuery<CloudCommandResponse>({
    queryKey: cloudCommandKey(commandId),
    queryFn: () => getCommandStatus(commandId!),
    enabled: enabled && commandId !== null,
  });
}

export function useEnqueueCloudCommand<TPayload>() {
  return useMutation<CloudCommandResponse, Error, CloudCommandEnvelope<TPayload>>({
    mutationFn: enqueueCommand,
  });
}

