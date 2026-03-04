/**
 * Session readiness middleware.
 */
import type { RequestHandler } from "express";
import type { HubManager } from "../../hub/manager/hub-manager";
import { ApiError } from "../errors/api-error";

/**
 * Ensures the session hub exists and runtime is ready.
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
