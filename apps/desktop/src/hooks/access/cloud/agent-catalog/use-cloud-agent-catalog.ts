import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getCloudAgentCatalog } from "@proliferate/cloud-sdk/client/agent-catalog";
import {
  buildDesktopLaunchModelRegistries,
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type CloudAgentCatalogResponseInput,
  type DesktopAgentLaunchCatalog,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { getBundledDesktopAgentLaunchCatalog } from "@/lib/domain/agents/bundled-agent-catalog";
import { cloudAgentCatalogKey } from "./query-keys";

async function fetchCloudAgentCatalogProjection(): Promise<DesktopAgentLaunchCatalog> {
  // The cloud endpoint serves the raw schemaVersion-2 catalog document; the
  // generated cloud-sdk response type lags the cutover, hence the assertion.
  return projectCloudAgentCatalogToDesktopLaunchCatalog(
    (await getCloudAgentCatalog()) as unknown as CloudAgentCatalogResponseInput,
  );
}

export function useCloudAgentCatalog(enabled = true) {
  return useQuery<DesktopAgentLaunchCatalog>({
    queryKey: cloudAgentCatalogKey(),
    queryFn: fetchCloudAgentCatalogProjection,
    enabled,
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

  return {
    ensureCloudAgentCatalog: (): Promise<DesktopAgentLaunchCatalog> =>
      queryClient.ensureQueryData({
        queryKey: cloudAgentCatalogKey(),
        queryFn: fetchCloudAgentCatalogProjection,
        initialData: getBundledDesktopAgentLaunchCatalog,
        initialDataUpdatedAt: 0,
        staleTime: 5 * 60 * 1000,
      }),
  };
}
