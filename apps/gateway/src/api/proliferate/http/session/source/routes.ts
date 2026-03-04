import { createLogger } from "@proliferate/logger";
import { sourceReads } from "@proliferate/services";
import { Router, type Router as RouterType } from "express";
import { ApiError } from "../../../../../middleware/errors";
import { resolveSessionWorker } from "./authz";
import { mapSourceReadError } from "./response";

const logger = createLogger({ service: "gateway" }).child({ module: "source" });

export function createSourceRoutes(): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.use((req, _res, next) => {
		req.proliferateSessionId = (req.params as Record<string, string>).proliferateSessionId;
		next();
	});

	router.get("/bindings", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) throw new ApiError(400, "Missing session ID");

			const authOrgId = req.auth?.source === "sandbox" ? undefined : req.auth?.orgId;
			const { workerId, organizationId } = await resolveSessionWorker(sessionId, authOrgId);
			const bindings = await sourceReads.listBindings(workerId, organizationId);

			logger.debug({ sessionId, count: bindings.length }, "Listed source bindings");
			res.json({ bindings });
		} catch (error) {
			next(error);
		}
	});

	router.get("/query", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) throw new ApiError(400, "Missing session ID");

			const bindingId = req.query.bindingId as string;
			if (!bindingId) throw new ApiError(400, "Missing bindingId query parameter");

			const cursor = (req.query.cursor as string) || undefined;
			const limit = req.query.limit ? Number(req.query.limit) : undefined;
			if (limit !== undefined && (Number.isNaN(limit) || limit < 1 || limit > 100)) {
				throw new ApiError(400, "limit must be between 1 and 100");
			}

			const authOrgId = req.auth?.source === "sandbox" ? undefined : req.auth?.orgId;
			const { organizationId } = await resolveSessionWorker(sessionId, authOrgId);
			const result = await sourceReads.querySource(bindingId, organizationId, cursor, limit);

			logger.debug(
				{ sessionId, bindingId, itemCount: result.items.length },
				"Source query completed",
			);
			res.json(result);
		} catch (error) {
			try {
				mapSourceReadError(error);
			} catch (mapped) {
				next(mapped);
			}
		}
	});

	router.get("/get", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) throw new ApiError(400, "Missing session ID");

			const bindingId = req.query.bindingId as string;
			const sourceRef = req.query.sourceRef as string;
			if (!bindingId) throw new ApiError(400, "Missing bindingId query parameter");
			if (!sourceRef) throw new ApiError(400, "Missing sourceRef query parameter");

			const authOrgId = req.auth?.source === "sandbox" ? undefined : req.auth?.orgId;
			const { organizationId } = await resolveSessionWorker(sessionId, authOrgId);
			const item = await sourceReads.getSourceItem(bindingId, organizationId, sourceRef);

			if (!item) throw new ApiError(404, "Source item not found");
			logger.debug({ sessionId, bindingId, sourceRef }, "Source item retrieved");
			res.json({ item });
		} catch (error) {
			try {
				mapSourceReadError(error);
			} catch (mapped) {
				next(mapped);
			}
		}
	});

	return router;
}
