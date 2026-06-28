import { parseMcpToolName } from "@proliferate/product-domain/chats/tools/mcp-tool-presentation";

const INTEGRATION_GATEWAY_MCP_SERVER = "proliferate_integrations";
const DESCRIPTION_PATTERN = /\buse this tool\b|[.!?]\s+\S/i;

export function integrationGatewayToolNameFromMcpName(
  toolName: string | null | undefined,
): string | null {
  const parsed = parseMcpToolName(toolName);
  if (!parsed || parsed.server !== INTEGRATION_GATEWAY_MCP_SERVER) {
    return null;
  }
  return parsed.action;
}

export function integrationToolDisplayNameFromMetadata(tool: {
  displayName: string;
  gatewayToolName: string;
  upstreamToolName: string;
}): string {
  const displayName = tool.displayName.trim();
  if (displayName && !looksLikeDescription(displayName)) {
    return displayName;
  }
  return (
    formatToolName(tool.upstreamToolName) ??
    formatToolName(tool.gatewayToolName) ??
    "Tool"
  );
}

function looksLikeDescription(value: string): boolean {
  return value.length > 72 || DESCRIPTION_PATTERN.test(value);
}

function formatToolName(value: string): string | null {
  const parts = value.split("__");
  const candidate = parts.length > 1 ? parts[parts.length - 1] : value;
  if (!candidate) {
    return null;
  }
  const spaced = candidate
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) {
    return null;
  }
  const words = spaced.split(/\s+/);
  return words.map(formatToolWord).join(" ");
}

function formatToolWord(word: string, index: number): string {
  const lowered = word.toLowerCase();
  if (["api", "id", "mcp", "oidc", "sso", "ssh", "url", "vpc"].includes(lowered)) {
    return lowered.toUpperCase();
  }
  if (index === 0) {
    return lowered.charAt(0).toUpperCase() + lowered.slice(1);
  }
  return lowered;
}
