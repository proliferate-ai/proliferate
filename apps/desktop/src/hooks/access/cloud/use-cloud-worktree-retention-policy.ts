import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorktreeRetentionPolicyRequest,
  CloudWorktreeRetentionPolicyResponse,
} from "@/lib/access/cloud/client";
import {
  getCloudWorktreeRetentionPolicy,
  putCloudWorktreeRetentionPolicy,
} from "@proliferate/cloud-sdk/client/worktree-policy";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "@/hooks/auth/facade/use-product-auth";
import { cloudWorktreeRetentionPolicyKey } from "@/hooks/access/cloud/query-keys";

export function useCloudWorktreeRetentionPolicy() {
  const authStatus = useProductAuthStatus();
  const userId = useProductAuthUserId();
  return useQuery<CloudWorktreeRetentionPolicyResponse>({
    queryKey: cloudWorktreeRetentionPolicyKey(userId),
    queryFn: getCloudWorktreeRetentionPolicy,
    enabled: authStatus === "authenticated" && userId !== null,
    staleTime: 30_000,
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
