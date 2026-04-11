import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { loadConnectorPaneData } from "@/lib/infra/mcp/persistence";
import { mcpConnectorsKey } from "./query-keys";

const EMPTY_INSTALLED: InstalledConnectorRecord[] = [];
const EMPTY_AVAILABLE: readonly ConnectorCatalogEntry[] = [];
const EMPTY_CONNECTOR_PANE_DATA = {
  installed: EMPTY_INSTALLED,
  available: EMPTY_AVAILABLE,
};

export function useConnectors() {
  return useQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadConnectorPaneData,
    placeholderData: EMPTY_CONNECTOR_PANE_DATA,
  });
}

export async function refreshMcpConnectorsQuery(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadConnectorPaneData,
    staleTime: 0,
  });
}
