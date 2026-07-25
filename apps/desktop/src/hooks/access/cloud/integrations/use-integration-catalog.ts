import { useQuery } from "@tanstack/react-query";
import { getIntegrationCatalog } from "@proliferate/cloud-sdk/client/integrations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { cloudIntegrationsCatalogKey } from "./query-keys";
import { isSignedInAuthStatus } from "@/lib/domain/auth/auth-state-mapping";

export function useIntegrationCatalog(
  organizationId: string | null,
  options?: { enabled?: boolean },
) {
  const authStatus = useAuthStore((state) => state.status);
  return useQuery({
    queryKey: cloudIntegrationsCatalogKey(organizationId),
    enabled: isSignedInAuthStatus(authStatus) && (options?.enabled ?? true),
    queryFn: () => getIntegrationCatalog({ organizationId }),
  });
}
