import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getIntegrationHealth } from "@proliferate/cloud-sdk/client/integrations";
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth";
import { cloudIntegrationsHealthKey, cloudIntegrationsRootKey } from "./query-keys";

export function useIntegrationHealth(
  organizationId: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    refetchOnWindowFocus?: boolean;
  },
) {
  const authStatus = useProductAuthStatus();
  return useQuery({
    queryKey: cloudIntegrationsHealthKey(organizationId),
    enabled: authStatus === "authenticated" && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    queryFn: () => getIntegrationHealth({ organizationId }),
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
