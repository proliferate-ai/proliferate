import { queryOptions, useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import type { CloudSandboxGatewayUrlSource } from "@/lib/access/cloud/cloud-sandbox-gateway";
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

export function cloudWorkspaceConnectionQueryOptions(
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
) {
  return queryOptions<CloudConnectionInfo>({
    queryKey: cloudWorkspaceConnectionKey(workspaceId),
    queryFn: () => getResolvedCloudWorkspaceConnection(workspaceId, cloudClient),
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
  const cloudClient = useProductHost().cloud.client;
  return useQuery({
    ...cloudWorkspaceConnectionQueryOptions(workspaceId ?? "", cloudClient),
    enabled: enabled && workspaceId !== null,
  });
}
