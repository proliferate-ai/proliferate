import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import {
  CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
  CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  getResolvedCloudWorkspaceConnection,
  isCloudWorkspaceNotReadyError,
  isRetryableCloudWorkspaceConnectionError,
} from "@/lib/access/cloud/workspace-connection-retry";

export {
  CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
  CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  isCloudWorkspaceNotReadyError,
  isRetryableCloudWorkspaceConnectionError,
};

export function cloudWorkspaceConnectionQueryOptions(workspaceId: string) {
  return queryOptions<CloudConnectionInfo>({
    queryKey: cloudWorkspaceConnectionKey(workspaceId),
    queryFn: () => getResolvedCloudWorkspaceConnection(workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (failureCount, error) =>
      failureCount < CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES
      && isRetryableCloudWorkspaceConnectionError(error),
    retryDelay: CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  });
}

export function useCloudWorkspaceConnection(
  workspaceId: string | null,
  enabled: boolean,
) {
  return useQuery({
    ...cloudWorkspaceConnectionQueryOptions(workspaceId ?? ""),
    enabled: enabled && workspaceId !== null,
  });
}
