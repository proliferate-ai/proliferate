/**
 * MCP connector client.
 *
 * Connects to remote MCP servers via Streamable HTTP transport,
 * lists their tools, and executes tool calls.
 *
 * Connection model: stateless per call. Each `listConnectorTools` or
 * `callConnectorTool` invocation creates a fresh transport + client,
 * initializes, performs the operation, and closes. The SDK's
 * `StreamableHTTPClientTransport` handles `Mcp-Session-Id` internally
 * within a single connection lifecycle.
 *
 * If a `callConnectorTool` fails with a 404 (session invalidation),
 * the client re-initializes once with a fresh connection and retries.
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
	sessionId?: string,
): StreamableHTTPClientTransport {
	const headers: Record<string, string> =
		config.auth.type === "custom_header"
			? { [config.auth.headerName]: resolvedSecret }
			: { Authorization: `Bearer ${resolvedSecret}` };

	if (sessionId) {
		headers["Mcp-Session-Id"] = sessionId;
	}

	return new StreamableHTTPClientTransport(new URL(config.url), {
		requestInit: { headers },
	});
}

// ============================================
// Error classification
// ============================================

function isSessionInvalidation(err: unknown): boolean {
	if (err instanceof Error) {
		return err.message.includes("404") || err.message.includes("session");
	}
	return false;
}

// ============================================
// Public API
// ============================================

/**
 * List tools from a remote MCP connector (throwing variant).
 * Connects, initializes, calls tools/list, then closes.
 * Throws on error — caller decides how to handle failures.
 */
export async function listConnectorToolsOrThrow(
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

		const toolActions: ActionDefinition[] = (result.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? "",
			riskLevel: deriveRiskLevel(tool.name, tool.annotations, config.riskPolicy),
			params: schemaToParams(tool.inputSchema),
		}));

		log.info({ toolCount: toolActions.length }, "Listed connector tools");
		return { connectorId: config.id, connectorName: config.name, actions: toolActions };
	} finally {
		try {
			await client.close();
		} catch {
			// best-effort close
		}
	}
}

/**
 * List tools from a remote MCP connector (safe variant).
 * Connects, initializes, calls tools/list, then closes.
 * On error: returns empty actions array and logs a warning.
 * Used by the gateway for runtime discovery where failures should not propagate.
 */
export async function listConnectorTools(
	config: ConnectorConfig,
	resolvedSecret: string,
): Promise<ConnectorToolList> {
	const log = logger().child({ connectorId: config.id, connectorName: config.name });
	try {
		return await listConnectorToolsOrThrow(config, resolvedSecret);
	} catch (err) {
		log.warn({ err }, "Failed to list connector tools");
		return { connectorId: config.id, connectorName: config.name, actions: [] };
	}
}

/**
 * Call a tool on a remote MCP connector.
 * Creates a connection, executes the call, and closes.
 *
 * If the server issues an `Mcp-Session-Id` during initialize and
 * later responds with 404 (session invalidation), the client
 * re-initializes once and retries the call.
 *
 * Throws on error (caller handles failure).
 */
export async function callConnectorTool(
	config: ConnectorConfig,
	resolvedSecret: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<ConnectorCallResult> {
	const log = logger().child({ connectorId: config.id, toolName });

	const attempt = async (mcpSessionId?: string): Promise<ConnectorCallResult> => {
		const transport = createTransport(config, resolvedSecret, mcpSessionId);
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
	};

	try {
		return await attempt();
	} catch (err) {
		// On 404 session invalidation: re-initialize without stale session ID and retry once
		if (isSessionInvalidation(err)) {
			log.info("Session invalidated (404), re-initializing and retrying");
			return await attempt();
		}
		throw err;
	}
}
