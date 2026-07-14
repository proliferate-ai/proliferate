import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorktreeRetentionPolicyRequest,
  CloudWorktreeRetentionPolicyResponse,
} from "@/lib/access/cloud/client";
import {
  getCloudWorktreeRetentionPolicy,
  putCloudWorktreeRetentionPolicy,
} from "@proliferate/cloud-sdk/client/worktree-policy";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";
import { cloudWorktreeRetentionPolicyKey } from "@/hooks/access/cloud/query-keys";

export function useCloudWorktreeRetentionPolicy() {
  const host = useProductHost();
  const authState = host.auth.state;
  const cloudClient = host.cloud.client;
  const authStatus = authState.status;
  const userId = authState.status === "authenticated" ? authState.user?.id ?? null : null;
  return useQuery<CloudWorktreeRetentionPolicyResponse>({
    queryKey: cloudWorktreeRetentionPolicyKey(userId),
    queryFn: () => getCloudWorktreeRetentionPolicy(cloudClient!),
    enabled:
      authStatus === "authenticated"
      && userId !== null
      && cloudClient !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function usePutCloudWorktreeRetentionPolicy() {
  const queryClient = useQueryClient();
  const host = useProductHost();
  const authState = host.auth.state;
  const cloudClient = host.cloud.client;
  const userId = authState.status === "authenticated" ? authState.user?.id ?? null : null;
  return useMutation({
    mutationFn: (input: CloudWorktreeRetentionPolicyRequest) =>
      putCloudWorktreeRetentionPolicy(input, requireHostCloudClient(cloudClient)),
    onSuccess: (policy) => {
      queryClient.setQueryData(cloudWorktreeRetentionPolicyKey(userId), policy);
    },
  });
}
