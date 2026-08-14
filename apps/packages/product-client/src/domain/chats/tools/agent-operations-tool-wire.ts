import type {
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";

export const AGENT_OPERATIONS_TOOL_PREFIX = "mcp__proliferate_workspace__";

type AgentOperationsWireItem = Pick<
  ToolCallItem,
  "nativeToolName" | "rawInput" | "rawOutput" | "contentParts"
>;

interface TrustedWorkspaceMcpEnvelope {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Resolves the one canonical presentation name from either a flat native MCP
 * call or the provider-neutral Codex MCP envelope. The historical `workspace`
 * value is a transport server id only; it is never accepted as a native MCP
 * namespace alias.
 */
export function resolveAgentOperationsToolName(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): string | null {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase() ?? "";
  if (nativeToolName.startsWith(AGENT_OPERATIONS_TOOL_PREFIX)) {
    return nativeToolName;
  }
  const envelope = trustedWorkspaceMcpEnvelope(item.rawInput);
  return envelope
    ? `${AGENT_OPERATIONS_TOOL_PREFIX}${envelope.tool.toLowerCase()}`
    : null;
}

/** Returns canonical tool arguments for presentation and authority checks. */
export function readAgentOperationsInput(
  item: Pick<ToolCallItem, "rawInput">,
): Record<string, unknown> | null {
  const envelope = trustedWorkspaceMcpEnvelope(item.rawInput);
  return envelope?.arguments ?? coerceRecord(item.rawInput);
}

/**
 * Returns the structured domain payload, unwrapping a provider-neutral MCP
 * CallToolResult when one is persisted by the adapter.
 */
export function readAgentOperationsOutput(
  item: AgentOperationsWireItem,
): Record<string, unknown> | null {
  const rawOutput = parseRecord(item.rawOutput);
  if (rawOutput) {
    return unwrapStructuredContent(rawOutput);
  }
  const text = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .find((part) => part.length > 0);
  const contentOutput = text ? parseRecord(text) : null;
  return contentOutput ? unwrapStructuredContent(contentOutput) : null;
}

function trustedWorkspaceMcpEnvelope(value: unknown): TrustedWorkspaceMcpEnvelope | null {
  const envelope = coerceRecord(value);
  if (!envelope) {
    return null;
  }
  const server = envelope.server;
  const tool = envelope.tool;
  const args = coerceRecord(envelope.arguments);
  if (
    (server !== "proliferate_workspace" && server !== "workspace")
    || typeof tool !== "string"
    || tool.trim().length === 0
    || !args
  ) {
    return null;
  }
  return { tool: tool.trim(), arguments: args };
}

function unwrapStructuredContent(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!("structuredContent" in value)) {
    return value;
  }
  return coerceRecord(value.structuredContent);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return coerceRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return coerceRecord(value);
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
