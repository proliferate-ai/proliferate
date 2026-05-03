import { useQuery } from "@tanstack/react-query";
import { listCustomMcpDefinitions } from "@/lib/integrations/cloud/mcp_custom_definitions";
import { mcpConnectorsKey } from "./query-keys";

export function useCustomMcpDefinitions() {
  return useQuery({
    queryKey: [...mcpConnectorsKey(), "custom-definitions"],
    queryFn: listCustomMcpDefinitions,
  });
}
