import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getCloudAgentCatalog } from "@proliferate/cloud-sdk/client/agent-catalog";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  buildDesktopLaunchModelRegistries,
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type CloudAgentCatalogResponseInput,
  type DesktopAgentLaunchCatalog,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { getBundledDesktopAgentLaunchCatalog } from "@/lib/domain/agents/bundled-agent-catalog";
import { cloudAgentCatalogKey } from "./query-keys";

async function fetchCloudAgentCatalogProjection(
  cloudClient: ProliferateCloudClient,
): Promise<DesktopAgentLaunchCatalog> {
  // The cloud endpoint serves the raw schemaVersion-2 catalog document; the
  // generated cloud-sdk response type lags the cutover, hence the assertion.
  return projectCloudAgentCatalogToDesktopLaunchCatalog(
    (await getCloudAgentCatalog(cloudClient)) as unknown as CloudAgentCatalogResponseInput,
  );
}

export function useCloudAgentCatalog(enabled = true) {
  const cloudClient = useProductHost().cloud.client;
  return useQuery<DesktopAgentLaunchCatalog>({
    queryKey: cloudAgentCatalogKey(),
    queryFn: () => fetchCloudAgentCatalogProjection(cloudClient!),
    enabled: enabled && cloudClient !== null,
    initialData: getBundledDesktopAgentLaunchCatalog,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useCloudLaunchModelRegistries(enabled = true) {
  const query = useCloudAgentCatalog(enabled);
  const modelRegistries = useMemo(
    () => buildDesktopLaunchModelRegistries(query.data?.agents ?? []),
    [query.data?.agents],
  );

  return {
    ...query,
    data: modelRegistries,
  };
}

export function useCloudAgentCatalogCache() {
  const queryClient = useQueryClient();
  const cloudClient = useProductHost().cloud.client;

  return {
    ensureCloudAgentCatalog: async (): Promise<DesktopAgentLaunchCatalog> => {
      if (!cloudClient) return getBundledDesktopAgentLaunchCatalog();
      return queryClient.ensureQueryData({
        queryKey: cloudAgentCatalogKey(),
        queryFn: () => fetchCloudAgentCatalogProjection(cloudClient),
        initialData: getBundledDesktopAgentLaunchCatalog,
        initialDataUpdatedAt: 0,
        staleTime: 5 * 60 * 1000,
      });
    },
  };
}
