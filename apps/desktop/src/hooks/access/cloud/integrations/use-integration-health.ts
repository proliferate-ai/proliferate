import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getIntegrationHealth } from "@proliferate/cloud-sdk/client/integrations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { cloudIntegrationsHealthKey, cloudIntegrationsRootKey } from "./query-keys";

export function useIntegrationHealth(
  organizationId: string | null,
  options?: { enabled?: boolean },
) {
  const authStatus = useAuthStore((state) => state.status);
  return useQuery({
    queryKey: cloudIntegrationsHealthKey(organizationId),
    enabled: authStatus === "authenticated" && (options?.enabled ?? true),
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
