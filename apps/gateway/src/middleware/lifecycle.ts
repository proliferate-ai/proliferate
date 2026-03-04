/**
 * Lifecycle Middleware
 *
 * Ensures the session hub exists and sandbox is running.
 */

import type { RequestHandler } from "express";
import type { HubManager } from "../hub/hub-manager";
import { ApiError } from "./error-handler";

/**
 * Create middleware that ensures the session is ready.
 * Loads session context and ensures sandbox is running.
 */
export function createEnsureSessionReady(hubManager: HubManager): RequestHandler {
	return async (req, _res, next) => {
		const { proliferateSessionId } = req.params;

		if (!proliferateSessionId) {
			return next(new ApiError(400, "Missing session ID"));
		}

		try {
			const hub = await hubManager.getOrCreate(proliferateSessionId);
			hub.touchActivity(); // Before ensureRuntimeReady — must not block on migration lock
			await hub.ensureRuntimeReady();

			req.hub = hub;
			req.proliferateSessionId = proliferateSessionId;
			next();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown error";
			next(new ApiError(503, "Session not available", { reason: message }));
		}
	};
}
