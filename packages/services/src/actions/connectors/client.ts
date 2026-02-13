/**
 * MCP connector client.
 *
 * Connects to remote MCP servers via Streamable HTTP transport,
 * lists their tools, and executes tool calls. Each operation creates
 * a fresh client connection (stateless per invocation).
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ConnectorConfig } from "@proliferate/shared";
import { getServicesLogger } from "../../logger";
import type { ActionDefinition, ActionParam } from "../adapters/types";
import { deriveRiskLevel } from "./risk";
import type { ConnectorCallResult, ConnectorToolList } from "./types";

const logger = () => getServicesLogger().child({ module: "mcp-connector" });

const TOOL_LIST_TIMEOUT_MS = 15_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;

interface McpContentBlock {
	type?: string;
	text?: string;
	[key: string]: unknown;
}

interface McpCallToolResultShape {
	content?: McpContentBlock[];
	structuredContent?: Record<string, unknown>;
}

// ============================================
// Schema conversion helpers
// ============================================

/** Map JSON Schema type to ActionParam type. */
function mapJsonSchemaType(schema: Record<string, unknown>): ActionParam["type"] {
	const t = schema.type;
	if (t === "string") return "string";
	if (t === "number" || t === "integer") return "number";
	if (t === "boolean") return "boolean";
	return "object";
}

/** Convert MCP tool inputSchema (JSON Schema) to ActionParam[]. */
export function schemaToParams(
	inputSchema: { properties?: Record<string, object>; required?: string[] } | undefined,
): ActionParam[] {
	if (!inputSchema?.properties) return [];
	const required = new Set(inputSchema.required ?? []);

	return Object.entries(inputSchema.properties).map(([name, prop]) => ({
		name,
		type: mapJsonSchemaType(prop as Record<string, unknown>),
		required: required.has(name),
		description: ((prop as Record<string, unknown>).description as string) ?? "",
	}));
}

/**
 * Normalize MCP tool result content for storage and CLI output.
 * Priority: structuredContent -> text content -> raw content blocks.
 */
export function extractToolCallContent(result: McpCallToolResultShape): unknown {
	if (result.structuredContent !== undefined) {
		return result.structuredContent;
	}

	const contentBlocks = Array.isArray(result.content) ? result.content : [];
	const textContent = contentBlocks
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("\n");

	if (textContent.length > 0) {
		try {
			return JSON.parse(textContent);
		} catch {
			return textContent;
		}
	}

	if (contentBlocks.length > 0) {
		return contentBlocks;
	}

	return null;
}

// ============================================
// Transport creation
// ============================================

function createTransport(
	config: ConnectorConfig,
	resolvedSecret: string,
): StreamableHTTPClientTransport {
	const headers: Record<string, string> =
		config.auth.type === "custom_header"
			? { [config.auth.headerName]: resolvedSecret }
			: { Authorization: `Bearer ${resolvedSecret}` };

	return new StreamableHTTPClientTransport(new URL(config.url), {
		requestInit: { headers },
	});
}

// ============================================
// Public API
// ============================================

/**
 * List tools from a remote MCP connector.
 * Connects, initializes, calls tools/list, then closes.
 * On error: returns empty actions array and logs a warning.
 */
export async function listConnectorTools(
	config: ConnectorConfig,
	resolvedSecret: string,
): Promise<ConnectorToolList> {
	const log = logger().child({ connectorId: config.id, connectorName: config.name });
	const transport = createTransport(config, resolvedSecret);
	const client = new Client({ name: "proliferate-gateway", version: "1.0.0" });

	try {
		await client.connect(transport);

		const result = await Promise.race([
			client.listTools(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("tools/list timeout")), TOOL_LIST_TIMEOUT_MS),
			),
		]);

		const actions: ActionDefinition[] = (result.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? "",
			riskLevel: deriveRiskLevel(tool.name, tool.annotations, config.riskPolicy),
			params: schemaToParams(tool.inputSchema),
		}));

		log.info({ toolCount: actions.length }, "Listed connector tools");
		return { connectorId: config.id, connectorName: config.name, actions };
	} catch (err) {
		log.warn({ err }, "Failed to list connector tools");
		return { connectorId: config.id, connectorName: config.name, actions: [] };
	} finally {
		try {
			await client.close();
		} catch {
			// best-effort close
		}
	}
}

/**
 * Call a tool on a remote MCP connector.
 * Creates a fresh connection for each call.
 * Throws on error (caller handles failure).
 */
export async function callConnectorTool(
	config: ConnectorConfig,
	resolvedSecret: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<ConnectorCallResult> {
	const log = logger().child({ connectorId: config.id, toolName });
	const transport = createTransport(config, resolvedSecret);
	const client = new Client({ name: "proliferate-gateway", version: "1.0.0" });

	try {
		await client.connect(transport);

		const result = await Promise.race([
			client.callTool({ name: toolName, arguments: args }),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("tools/call timeout")), TOOL_CALL_TIMEOUT_MS),
			),
		]);
		const content = extractToolCallContent(result as McpCallToolResultShape);

		const isError = "isError" in result && result.isError === true;
		log.info({ isError }, "Connector tool call complete");
		return { content, isError };
	} finally {
		try {
			await client.close();
		} catch {
			// best-effort close
		}
	}
}
