import { useQuery } from "@tanstack/react-query";
import {
  getTarget,
  listTargets,
  type CloudTargetDetail,
  type CloudTargetSummary,
} from "@proliferate/cloud-sdk";
import { cloudTargetKey, cloudTargetsKey } from "../lib/query-keys";

export function useCloudTargets(enabled = true) {
  return useQuery<CloudTargetSummary[]>({
    queryKey: cloudTargetsKey(),
    queryFn: listTargets,
    enabled,
  });
}

export function useCloudTarget(targetId: string | null, enabled = true) {
  return useQuery<CloudTargetDetail>({
    queryKey: cloudTargetKey(targetId),
    queryFn: () => getTarget(targetId!),
    enabled: enabled && targetId !== null,
  });
}

