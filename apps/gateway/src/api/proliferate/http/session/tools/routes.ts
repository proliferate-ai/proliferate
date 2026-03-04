import { createLogger } from "@proliferate/logger";
import { Router } from "express";
import type { HubManager } from "../../../../../hub";
import { getInterceptedToolHandler } from "../../../../../hub/capabilities/tools";
import { ApiError } from "../../../../../middleware/errors";

const logger = createLogger({ service: "gateway" }).child({ module: "http-tools" });

interface ToolCallResult {
	success: boolean;
	result: string;
	data?: Record<string, unknown>;
}

const inflightCalls = new Map<string, Promise<ToolCallResult>>();
const completedResults = new Map<string, ToolCallResult>();
const RESULT_RETENTION_MS = 5 * 60 * 1000;

function cacheKey(sessionId: string, toolName: string, toolCallId: string): string {
	return `${sessionId}:${toolName}:${toolCallId}`;
}

function evictAfterDelay(key: string): void {
	setTimeout(() => {
		completedResults.delete(key);
	}, RESULT_RETENTION_MS);
}

export function createToolsRoutes(hubManager: HubManager): Router {
	const router = Router({ mergeParams: true });

	router.post("/:toolName", async (req, res, next) => {
		try {
			const { proliferateSessionId, toolName } = req.params as Record<string, string>;
			const { tool_call_id: toolCallId, args } = req.body as {
				tool_call_id?: string;
				args?: Record<string, unknown>;
			};

			if (!proliferateSessionId) throw new ApiError(400, "Missing session ID");
			if (!toolName) throw new ApiError(400, "Missing tool name");
			if (!toolCallId || typeof toolCallId !== "string") {
				throw new ApiError(400, "Missing or invalid tool_call_id");
			}
			if (req.auth?.source !== "sandbox") {
				throw new ApiError(403, "Tool routes require sandbox authentication");
			}

			const handler = getInterceptedToolHandler(toolName);
			if (!handler) throw new ApiError(404, `Unknown tool: ${toolName}`);

			const key = cacheKey(proliferateSessionId, toolName, toolCallId);
			const cached = completedResults.get(key);
			if (cached) {
				res.json(cached);
				return;
			}

			const inflight = inflightCalls.get(key);
			if (inflight) {
				res.json(await inflight);
				return;
			}

			const hub = await hubManager.getOrCreate(proliferateSessionId);
			const toolArgs = args ?? {};
			const executePromise = (async (): Promise<ToolCallResult> => {
				hub.trackToolCallStart();
				try {
					const result = await handler.execute(hub, toolArgs);
					return { success: result.success, result: result.result, data: result.data };
				} finally {
					hub.trackToolCallEnd();
				}
			})();

			inflightCalls.set(key, executePromise);
			try {
				const result = await executePromise;
				completedResults.set(key, result);
				evictAfterDelay(key);
				res.json(result);
			} finally {
				inflightCalls.delete(key);
			}
		} catch (error) {
			logger.error({ err: error }, "Tool callback failed");
			next(error);
		}
	});

	return router;
}
