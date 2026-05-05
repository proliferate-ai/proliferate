import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorktreeRetentionPolicyRequest,
  CloudWorktreeRetentionPolicyResponse,
} from "@/lib/integrations/cloud/client";
import {
  getCloudWorktreeRetentionPolicy,
  putCloudWorktreeRetentionPolicy,
} from "@/lib/integrations/cloud/worktree-policy";
import { useAuthStore } from "@/stores/auth/auth-store";
import { cloudWorktreeRetentionPolicyKey } from "./query-keys";

export function useCloudWorktreeRetentionPolicy() {
  const authStatus = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.user?.id ?? null);
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
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useMutation({
    mutationFn: (input: CloudWorktreeRetentionPolicyRequest) =>
      putCloudWorktreeRetentionPolicy(input),
    onSuccess: (policy) => {
      queryClient.setQueryData(cloudWorktreeRetentionPolicyKey(userId), policy);
    },
  });
}
