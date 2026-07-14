import { useQuery } from "@tanstack/react-query";
import { getIntegrationCatalog } from "@proliferate/cloud-sdk/client/integrations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudIntegrationsCatalogKey } from "./query-keys";

export function useIntegrationCatalog(
  organizationId: string | null,
  options?: { enabled?: boolean },
) {
  const host = useProductHost();
  const authStatus = host.auth.state.status;
  const cloudClient = host.cloud.client;
  return useQuery({
    queryKey: cloudIntegrationsCatalogKey(organizationId),
    enabled:
      authStatus === "authenticated"
      && cloudClient !== null
      && (options?.enabled ?? true),
    queryFn: () => getIntegrationCatalog({ organizationId }, cloudClient!),
  });
}
