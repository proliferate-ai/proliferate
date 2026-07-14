import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getIntegrationHealth } from "@proliferate/cloud-sdk/client/integrations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudIntegrationsHealthKey, cloudIntegrationsRootKey } from "./query-keys";

export function useIntegrationHealth(
  organizationId: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    refetchOnWindowFocus?: boolean;
  },
) {
  const host = useProductHost();
  const authStatus = host.auth.state.status;
  const cloudClient = host.cloud.client;
  return useQuery({
    queryKey: cloudIntegrationsHealthKey(organizationId),
    enabled:
      authStatus === "authenticated"
      && cloudClient !== null
      && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    queryFn: () => getIntegrationHealth({ organizationId }, cloudClient!),
  });
}

/** Invalidate every integrations query (catalog, health, admin, flows). */
export function useInvalidateCloudIntegrations() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: cloudIntegrationsRootKey() }),
    [queryClient],
  );
}
