import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  bootstrapCloudWorkspaceRemoteAccess,
  type BootstrapCloudWorkspaceRemoteAccessRequest,
  disableCloudWorkspaceRemoteAccess,
  enableCloudWorkspaceRemoteAccess,
} from "@proliferate/cloud-sdk/client/workspaces";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { cloudRootKey } from "@/hooks/access/cloud/query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

async function invalidateWorkspaceAccessCaches(
  queryClient: QueryClient,
  runtimeUrl: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: cloudRootKey() }),
    queryClient.invalidateQueries({ queryKey: workspaceCollectionsScopeKey(runtimeUrl) }),
  ]);
}

export function useEnableCloudWorkspaceRemoteAccess() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useMutation<CloudWorkspaceDetail, Error, string>({
    mutationFn: (workspaceId) => enableCloudWorkspaceRemoteAccess(workspaceId),
    onSuccess: async () => {
      await invalidateWorkspaceAccessCaches(queryClient, runtimeUrl);
    },
  });
}

export function useBootstrapCloudWorkspaceRemoteAccess() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useMutation<
    CloudWorkspaceDetail,
    Error,
    BootstrapCloudWorkspaceRemoteAccessRequest
  >({
    mutationFn: (input) => bootstrapCloudWorkspaceRemoteAccess(input),
    onSuccess: async () => {
      await invalidateWorkspaceAccessCaches(queryClient, runtimeUrl);
    },
  });
}

export function useDisableCloudWorkspaceRemoteAccess() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useMutation<CloudWorkspaceDetail, Error, string>({
    mutationFn: (workspaceId) => disableCloudWorkspaceRemoteAccess(workspaceId),
    onSuccess: async () => {
      await invalidateWorkspaceAccessCaches(queryClient, runtimeUrl);
    },
  });
}
