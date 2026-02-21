/**
 * HTTP Tool Routes
 *
 * Synchronous HTTP callback endpoints for sandbox-side tool execution.
 * The sandbox calls POST /proliferate/:sessionId/tools/:toolName with args,
 * the Gateway executes the tool server-side, and returns the result.
 *
 * Uses tool_call_id for idempotency: if a retry arrives while the first
 * execution is still running, the Gateway awaits the existing promise
 * instead of executing the tool twice. This handles the Snapshot TCP Drop
 * where containers freeze/thaw and retry with the same tool_call_id.
 */

import { createLogger } from "@proliferate/logger";
import { Router } from "express";
import type { HubManager } from "../../../hub";
import { getInterceptedToolHandler } from "../../../hub/capabilities/tools";
import type { GatewayEnv } from "../../../lib/env";
import { ApiError } from "../../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "http-tools" });

interface ToolCallResult {
	success: boolean;
	result: string;
	data?: Record<string, unknown>;
}

/**
 * In-memory idempotency cache: tool_call_id → Promise<ToolCallResult>.
 * Entries are evicted after completion + a grace period.
 */
const inflightCalls = new Map<string, Promise<ToolCallResult>>();
const completedResults = new Map<string, ToolCallResult>();

/** How long to keep completed results for retry dedup (5 minutes). */
const RESULT_RETENTION_MS = 5 * 60 * 1000;

/** Build a scoped cache key to prevent cross-session collisions. */
function cacheKey(sessionId: string, toolName: string, toolCallId: string): string {
	return `${sessionId}:${toolName}:${toolCallId}`;
}

function evictAfterDelay(key: string): void {
	setTimeout(() => {
		completedResults.delete(key);
	}, RESULT_RETENTION_MS);
}

export function createToolsRouter(_env: GatewayEnv, hubManager: HubManager): Router {
	const router = Router({ mergeParams: true });

	/**
	 * POST /:proliferateSessionId/tools/:toolName
	 *
	 * Body: { tool_call_id: string, args: Record<string, unknown> }
	 * Auth: sandbox HMAC token (source: "sandbox")
	 */
	router.post("/:toolName", async (req, res, next) => {
		try {
			const { proliferateSessionId, toolName } = req.params as Record<string, string>;
			const { tool_call_id: toolCallId, args } = req.body as {
				tool_call_id?: string;
				args?: Record<string, unknown>;
			};

			if (!proliferateSessionId) {
				throw new ApiError(400, "Missing session ID");
			}
			if (!toolName) {
				throw new ApiError(400, "Missing tool name");
			}
			if (!toolCallId || typeof toolCallId !== "string") {
				throw new ApiError(400, "Missing or invalid tool_call_id");
			}

			// Only sandbox tokens may call tool routes
			if (req.auth?.source !== "sandbox") {
				throw new ApiError(403, "Tool routes require sandbox authentication");
			}

			const handler = getInterceptedToolHandler(toolName);
			if (!handler) {
				throw new ApiError(404, `Unknown tool: ${toolName}`);
			}

			const key = cacheKey(proliferateSessionId, toolName, toolCallId);

			// Check completed result cache (retry after snapshot thaw)
			const cached = completedResults.get(key);
			if (cached) {
				logger.debug({ toolCallId, toolName }, "Returning cached tool result");
				res.json(cached);
				return;
			}

			// Check in-flight dedup (retry while first call is still running)
			const inflight = inflightCalls.get(key);
			if (inflight) {
				logger.debug({ toolCallId, toolName }, "Awaiting in-flight tool call");
				const result = await inflight;
				res.json(result);
				return;
			}

			// Execute the tool
			const hub = await hubManager.getOrCreate(proliferateSessionId);
			const toolArgs = args ?? {};

			const executePromise = (async (): Promise<ToolCallResult> => {
				logger.info({ toolCallId, toolName, sessionId: proliferateSessionId }, "Executing tool");
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

				// Cache the result for retries
				completedResults.set(key, result);
				evictAfterDelay(key);

				res.json(result);
			} finally {
				inflightCalls.delete(key);
			}
		} catch (err) {
			next(err);
		}
	});

	return router;
}
