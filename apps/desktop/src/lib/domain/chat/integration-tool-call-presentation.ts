import { parseMcpToolName } from "@proliferate/product-domain/chats/tools/mcp-tool-presentation";

const INTEGRATION_GATEWAY_MCP_SERVER = "proliferate_integrations";

export function integrationGatewayToolNameFromMcpName(
  toolName: string | null | undefined,
): string | null {
  const parsed = parseMcpToolName(toolName);
  if (!parsed || parsed.server !== INTEGRATION_GATEWAY_MCP_SERVER) {
    return null;
  }
  return parsed.action;
}
