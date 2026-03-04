import { createLogger } from "@proliferate/logger";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../../../hub";
import { ApiError } from "../../../../../middleware/errors";

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

			hubManager
				.getOrCreate(sessionId)
				.then((hub) => hub.eagerStart())
				.catch((error) => {
					logger.error({ err: error, sessionId }, "Eager start failed");
				});

			res.status(202).json({ ok: true });
		} catch (error) {
			next(error);
		}
	});

	return router;
}
