import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { loadConnectorPaneData } from "@/lib/workflows/mcp/connector-persistence";
import { mcpConnectorsKey } from "./query-keys";

export function useConnectors() {
  return useQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadConnectorPaneData,
  });
}

export async function refreshMcpConnectorsQuery(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    queryKey: mcpConnectorsKey(),
    queryFn: loadConnectorPaneData,
    staleTime: 0,
  });
}
