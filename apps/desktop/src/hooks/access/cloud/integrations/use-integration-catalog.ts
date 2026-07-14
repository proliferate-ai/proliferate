import { useQuery } from "@tanstack/react-query";
import { getIntegrationCatalog } from "@proliferate/cloud-sdk/client/integrations";
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth";
import { cloudIntegrationsCatalogKey } from "./query-keys";

export function useIntegrationCatalog(
  organizationId: string | null,
  options?: { enabled?: boolean },
) {
  const authStatus = useProductAuthStatus();
  return useQuery({
    queryKey: cloudIntegrationsCatalogKey(organizationId),
    enabled: authStatus === "authenticated" && (options?.enabled ?? true),
    queryFn: () => getIntegrationCatalog({ organizationId }),
  });
}
