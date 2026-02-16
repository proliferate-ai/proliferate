/**
 * McpConnectorActionSource — Archetype B action source.
 *
 * Wraps an org_connectors DB row into the ActionSource interface.
 * listActions() connects to the MCP server and discovers tools dynamically.
 * execute() calls the MCP server's tools/call endpoint statelessly.
 *
 * Transport details (URL, auth headers, retry on 404 session invalidation)
 * are encapsulated here. The Gateway sees only ActionSource.execute().
 */

import type {
	ActionDefinition,
	ActionExecutionContext,
	ActionResult,
	ActionSource,
} from "@proliferate/providers";
import { jsonSchemaToZod } from "@proliferate/providers/helpers/schema";
import type { ConnectorConfig } from "@proliferate/shared";
import { getServicesLogger } from "../../logger";
import { callConnectorTool, listConnectorToolsRaw } from "./client";
import { deriveRiskLevel } from "./risk";

const logger = () => getServicesLogger().child({ module: "mcp-connector-source" });

/**
 * ActionSource implementation for MCP connector-backed tools.
 *
 * Constructed with a connector config and its resolved secret.
 * The secret is used internally for MCP transport auth — the
 * ActionExecutionContext.token is ignored.
 */
export class McpConnectorActionSource implements ActionSource {
	readonly id: string;
	readonly displayName: string;

	constructor(
		private config: ConnectorConfig,
		private resolvedSecret: string,
	) {
		this.id = `connector:${config.id}`;
		this.displayName = config.name;
	}

	/**
	 * Discover available tools from the MCP server.
	 * Connects, lists tools, converts JSON Schema → Zod, and closes.
	 */
	async listActions(_ctx: ActionExecutionContext): Promise<ActionDefinition[]> {
		const tools = await listConnectorToolsRaw(this.config, this.resolvedSecret);

		return tools.map((tool) => ({
			id: tool.name,
			description: tool.description ?? "",
			riskLevel: deriveRiskLevel(tool.name, tool.annotations, this.config.riskPolicy),
			params: jsonSchemaToZod((tool.inputSchema as Record<string, unknown>) ?? { type: "object" }),
		}));
	}

	/**
	 * Execute an MCP tool call.
	 * Creates a fresh transport per call (stateless). Retries once on 404.
	 */
	async execute(
		actionId: string,
		params: Record<string, unknown>,
		_ctx: ActionExecutionContext,
	): Promise<ActionResult> {
		const log = logger().child({ connectorId: this.config.id, actionId });
		const startMs = Date.now();

		try {
			const result = await callConnectorTool(this.config, this.resolvedSecret, actionId, params);

			const durationMs = Date.now() - startMs;
			log.info({ durationMs, isError: result.isError }, "Connector action executed");

			if (result.isError) {
				return {
					success: false,
					error:
						typeof result.content === "string" ? result.content : JSON.stringify(result.content),
					durationMs,
				};
			}

			return {
				success: true,
				data: result.content,
				durationMs,
			};
		} catch (err) {
			const durationMs = Date.now() - startMs;
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error({ err, durationMs }, "Connector action failed");
			return {
				success: false,
				error: errorMsg,
				durationMs,
			};
		}
	}
}
