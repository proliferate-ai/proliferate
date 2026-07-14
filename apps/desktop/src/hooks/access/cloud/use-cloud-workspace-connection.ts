import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { cloudWorkspaceConnectionAuthorityKey } from "@/hooks/access/cloud/query-keys";
import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
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

export function cloudWorkspaceConnectionQueryOptions(
  workspaceId: string,
  cloudClient: ProliferateCloudClient | null,
  authorityScopeKey: string,
) {
  return queryOptions<CloudConnectionInfo>({
    queryKey: cloudWorkspaceConnectionAuthorityKey(
      workspaceId,
      authorityScopeKey,
    ),
    queryFn: () => {
      if (!cloudClient) {
        throw new Error("Cloud workspace access is unavailable for this host.");
      }
      return getResolvedCloudWorkspaceConnection(workspaceId, cloudClient);
    },
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
  const { client: cloudClient, scopeKey } = useCloudConnectionAuthority();
  return useQuery({
    ...cloudWorkspaceConnectionQueryOptions(
      workspaceId ?? "",
      cloudClient,
      scopeKey,
    ),
    enabled: enabled && workspaceId !== null && cloudClient !== null,
  });
}
