import { useQuery } from "@tanstack/react-query";
import {
  getTarget,
  listTargets,
  type CloudTargetDetail,
  type CloudTargetSummary,
} from "@proliferate/cloud-sdk";
import { cloudTargetKey, cloudTargetsKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudTargets(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudTargetSummary[]>({
    queryKey: cloudTargetsKey(),
    queryFn: () => listTargets(client),
    enabled,
  });
}

export function useCloudTarget(targetId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudTargetDetail>({
    queryKey: cloudTargetKey(targetId),
    queryFn: () => getTarget(targetId!, client),
    enabled: enabled && targetId !== null,
  });
}
