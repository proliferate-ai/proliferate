import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveFunctionInvocation,
  createFunctionInvocation,
  listFunctionInvocations,
  rotateFunctionInvocationHeaders,
  setFunctionInvocationChatScopeEnabled,
  updateFunctionInvocation,
  type CreateFunctionInvocationRequest,
  type UpdateFunctionInvocationRequest,
} from "@proliferate/cloud-sdk/client/integrations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { cloudFunctionInvocationsKey } from "./query-keys";

/**
 * The owner's function-invocation definitions (track 1b phase 3 settings
 * surface). Person-scoped — no organization parameter, unlike the org-admin
 * integration hooks alongside this one.
 */
export function useFunctionInvocations(options?: { enabled?: boolean }) {
  const authStatus = useAuthStore((state) => state.status);
  return useQuery({
    queryKey: cloudFunctionInvocationsKey(),
    enabled: authStatus === "authenticated" && (options?.enabled ?? true),
    queryFn: () => listFunctionInvocations(),
  });
}

export function useFunctionInvocationActions() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: cloudFunctionInvocationsKey() });

  const createMutation = useMutation({
    mutationFn: (input: CreateFunctionInvocationRequest) => createFunctionInvocation(input),
    onSuccess: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpdateFunctionInvocationRequest }) =>
      updateFunctionInvocation(name, input),
    onSuccess: () => invalidate(),
  });

  const rotateHeadersMutation = useMutation({
    mutationFn: ({ name, headers }: { name: string; headers: Record<string, string> | null }) =>
      rotateFunctionInvocationHeaders(name, headers),
    onSuccess: () => invalidate(),
  });

  const setChatScopeEnabledMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setFunctionInvocationChatScopeEnabled(name, enabled),
    onSuccess: () => invalidate(),
  });

  const archiveMutation = useMutation({
    mutationFn: (name: string) => archiveFunctionInvocation(name),
    onSuccess: () => invalidate(),
  });

  return {
    create: createMutation.mutateAsync,
    creating: createMutation.isPending,
    update: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    rotateHeaders: rotateHeadersMutation.mutateAsync,
    rotatingHeaders: rotateHeadersMutation.isPending,
    setChatScopeEnabled: setChatScopeEnabledMutation.mutateAsync,
    settingChatScopeEnabled: setChatScopeEnabledMutation.isPending,
    archive: archiveMutation.mutateAsync,
    archiving: archiveMutation.isPending,
  };
}
