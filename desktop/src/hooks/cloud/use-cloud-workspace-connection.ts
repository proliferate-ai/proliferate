import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CloudConnectionInfo } from "@/lib/integrations/cloud/client";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import { getCloudWorkspaceConnection } from "@/lib/integrations/cloud/workspaces";
import { cloudWorkspaceConnectionKey } from "./query-keys";

const CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS = 750;
const CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES = 8;

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isRetryableCloudWorkspaceConnectionError(error: unknown): boolean {
  if (error instanceof ProliferateClientError) {
    return isCloudWorkspaceNotReadyError(error) || error.status >= 500;
  }

  return isRetryableNetworkError(error);
}

export function isCloudWorkspaceNotReadyError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && error.code === "workspace_not_ready";
}

export function cloudWorkspaceConnectionQueryOptions(workspaceId: string) {
  return queryOptions<CloudConnectionInfo>({
    queryKey: cloudWorkspaceConnectionKey(workspaceId),
    queryFn: () => getCloudWorkspaceConnection(workspaceId),
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
