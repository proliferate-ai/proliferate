import { useQuery } from "@tanstack/react-query";
import {
  getCloudAgentCatalog,
  type CloudAgentCatalogResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { cloudAgentCatalogKey } from "../lib/query-keys.js";

export function useCloudAgentCatalog(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudAgentCatalogResponse>({
    queryKey: cloudAgentCatalogKey(),
    queryFn: () => getCloudAgentCatalog(client),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
