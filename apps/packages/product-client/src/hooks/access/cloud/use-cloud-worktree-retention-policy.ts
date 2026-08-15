import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CloudWorktreeRetentionPolicyRequest, CloudWorktreeRetentionPolicyResponse } from "@proliferate/cloud-sdk/types";
import {
  getCloudWorktreeRetentionPolicy,
  putCloudWorktreeRetentionPolicy,
} from "@proliferate/cloud-sdk/client/worktree-policy";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "#product/hooks/auth/facade/use-product-auth";
import { cloudWorktreeRetentionPolicyKey } from "#product/hooks/access/cloud/query-keys";

// Named exception (does not sit on the `cadence` scale): 30s falls strictly
// between `cadence.relaxedMs` (15s) and `cadence.slowMs` (60s) — the same
// band `WORKSPACE_COLLECTIONS_STALE_MS` occupies. Snapping down tightens
// (forbidden); snapping up doubles how long a stale retention-policy read can
// back the settings pane after a user changes it elsewhere. Kept as its own
// named constant (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
const CLOUD_WORKTREE_RETENTION_POLICY_STALE_MS = 30_000;

export function useCloudWorktreeRetentionPolicy() {
  const authStatus = useProductAuthStatus();
  const userId = useProductAuthUserId();
  return useQuery<CloudWorktreeRetentionPolicyResponse>({
    queryKey: cloudWorktreeRetentionPolicyKey(userId),
    queryFn: getCloudWorktreeRetentionPolicy,
    enabled: authStatus === "authenticated" && userId !== null,
    staleTime: CLOUD_WORKTREE_RETENTION_POLICY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function usePutCloudWorktreeRetentionPolicy() {
  const queryClient = useQueryClient();
  const userId = useProductAuthUserId();
  return useMutation({
    mutationFn: (input: CloudWorktreeRetentionPolicyRequest) =>
      putCloudWorktreeRetentionPolicy(input),
    onSuccess: (policy) => {
      queryClient.setQueryData(cloudWorktreeRetentionPolicyKey(userId), policy);
    },
  });
}
