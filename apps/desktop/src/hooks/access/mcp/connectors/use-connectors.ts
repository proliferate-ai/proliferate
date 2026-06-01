import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { loadCloudConnectorPaneData } from "@/lib/workflows/mcp/connector-catalog-persistence";
import { mcpConnectorsKey } from "./query-keys";

export function useConnectors() {
  return useQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadCloudConnectorPaneData,
  });
}

export async function refreshMcpConnectorsQuery(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadCloudConnectorPaneData,
    staleTime: 0,
  });
}
