import { createLogger } from "@proliferate/logger";
import { Router, type Router as RouterType } from "express";
import { executeManagerTool } from "../../../../../harness/manager/tools";
import type { HubManager } from "../../../../../hub";
import { ApiError } from "../../../../../server/middleware/errors";
import { createManagerToolExecutionContext, requireManagerControlSession } from "./helpers";

const logger = createLogger({ service: "gateway" }).child({ module: "manager-control" });

export function createManagerRoutes(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.use((req, _res, next) => {
		req.proliferateSessionId = req.params.proliferateSessionId;
		next();
	});

	router.post("/tools/execute", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}

			if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
				throw new ApiError(400, "Body must be a JSON object");
			}
			const { toolName, args } = req.body as {
				toolName?: string;
				args?: Record<string, unknown>;
			};
			if (!toolName || typeof toolName !== "string") {
				throw new ApiError(400, "Missing or invalid toolName");
			}
			if (
				args !== undefined &&
				(typeof args !== "object" || args === null || Array.isArray(args))
			) {
				throw new ApiError(400, "args must be an object");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);

			const result = await executeManagerTool(
				toolName,
				args ?? {},
				createManagerToolExecutionContext({ managerSession, hubManager }),
				logger.child({
					managerSessionId: sessionId,
					toolName,
				}),
			);
			res.json({ result });
		} catch (error) {
			next(error);
		}
	});

	return router;
}
