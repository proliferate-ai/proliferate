import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getCloudAgentCatalog } from "@proliferate/cloud-sdk/client/agent-catalog";
import {
  buildDesktopLaunchModelRegistries,
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type CloudAgentCatalogResponseInput,
  type DesktopAgentLaunchCatalog,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import { getBundledDesktopAgentLaunchCatalog } from "#product/lib/domain/agents/bundled-agent-catalog";
import { cloudAgentCatalogKey } from "#product/hooks/access/cloud/agent-catalog/query-keys";

// Named exception (does not sit on the `cadence` scale): 5 minutes is longer
// than even `cadence.slowMs` (60s), the scale's largest token. The agent
// catalog changes on a release cadence, not a per-session one, so a stale
// time an order of magnitude beyond `slow` is intentional rather than an
// oversight (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
const CLOUD_AGENT_CATALOG_STALE_MS = 5 * 60 * 1000;

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
    staleTime: CLOUD_AGENT_CATALOG_STALE_MS,
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
        staleTime: CLOUD_AGENT_CATALOG_STALE_MS,
      }),
  };
}
