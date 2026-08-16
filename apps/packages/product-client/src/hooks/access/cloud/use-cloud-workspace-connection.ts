import { queryOptions, useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { CloudConnectionInfo } from "@proliferate/cloud-sdk/types";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { cloudWorkspaceConnectionKey } from "#product/hooks/access/cloud/query-keys";
import {
  CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
  CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  cloudWorkspaceConnectionRetryBudget,
  getResolvedCloudWorkspaceConnection,
  isCloudWorkspaceNotReadyError,
  isRetryableCloudWorkspaceConnectionError,
} from "#product/lib/access/cloud/workspace-connection-retry";

export {
  CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
  CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  isCloudWorkspaceNotReadyError,
  isRetryableCloudWorkspaceConnectionError,
};

// Named exception (does not sit on the `cadence` scale): 30s falls strictly
// between `cadence.relaxedMs` (15s) and `cadence.slowMs` (60s) — the same
// band `WORKSPACE_COLLECTIONS_STALE_MS` occupies. This resolves the cloud
// sandbox gateway connection info a session runtime dials into; snapping
// down tightens (forbidden), and snapping up doubles how long a stale
// connection can be reused before `refetchOnWindowFocus`/`refetchOnMount`
// (both already `true` here) catch a rotated URL. Kept as its own named
// constant (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
const CLOUD_WORKSPACE_CONNECTION_STALE_MS = 30_000;

export function cloudWorkspaceConnectionQueryOptions(
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
) {
  return queryOptions<CloudConnectionInfo>({
    queryKey: cloudWorkspaceConnectionKey(workspaceId),
    queryFn: () => getResolvedCloudWorkspaceConnection(workspaceId, cloudClient),
    staleTime: CLOUD_WORKSPACE_CONNECTION_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failureCount, error) =>
      failureCount < cloudWorkspaceConnectionRetryBudget(error).maxRetries
      && isRetryableCloudWorkspaceConnectionError(error),
    retryDelay: (_failureCount, error) =>
      cloudWorkspaceConnectionRetryBudget(error).delayMs,
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
