/**
 * Eager Start Route
 *
 * POST /proliferate/:proliferateSessionId/eager-start
 *
 * Triggers session startup (sandbox boot + initial prompt) without a WebSocket client.
 * Used by the web API to start sessions in the background after creation.
 * Service auth only.
 */

import { createLogger } from "@proliferate/logger";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../hub";
import { ApiError } from "../../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "eager-start" });

export function createEagerStartRouter(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.post("/eager-start", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth || auth.source !== "service") {
				throw new ApiError(403, "Eager start requires service authentication");
			}

			const { proliferateSessionId: sessionId } = req.params as Record<string, string>;
			if (!sessionId) {
				throw new ApiError(400, "Session ID is required");
			}

			// Fire-and-forget: create hub and start the session in the background
			hubManager
				.getOrCreate(sessionId)
				.then((hub) => hub.eagerStart())
				.catch((err) => {
					logger.error({ err, sessionId }, "Eager start failed");
				});

			res.status(202).json({ ok: true });
		} catch (err) {
			next(err);
		}
	});

	return router;
}
