/**
 * Source Read Routes
 *
 * HTTP API for source reads. The manager harness (or CLI) calls these
 * to query connected external data sources (Sentry, Linear, GitHub).
 *
 * Credentials are resolved server-side; the caller never receives raw tokens.
 *
 * Routes (all under /:proliferateSessionId/source/):
 *   GET  /bindings          — list source bindings for the session's worker
 *   GET  /query             — paginated source query
 *   GET  /get               — single source item detail
 */

import { createLogger } from "@proliferate/logger";
import { sessions, sourceReads } from "@proliferate/services";
import { Router, type Router as RouterType } from "express";
import type { GatewayEnv } from "../../../lib/env";
import { ApiError } from "../../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "source" });

export function createSourceRouter(_env: GatewayEnv): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	// Set proliferateSessionId from URL params
	router.use((req, _res, next) => {
		req.proliferateSessionId = (req.params as Record<string, string>).proliferateSessionId;
		next();
	});

	/**
	 * Resolve the session's worker ID and org from the session ID in params.
	 */
	async function resolveSessionWorker(sessionId: string, authOrgId?: string) {
		const session = await sessions.findByIdInternal(sessionId);
		if (!session) {
			throw new ApiError(404, "Session not found");
		}

		// For non-sandbox callers, verify org access
		if (authOrgId && authOrgId !== session.organizationId) {
			throw new ApiError(403, "You do not have access to this session");
		}

		if (!session.workerId) {
			throw new ApiError(400, "Session is not associated with a worker");
		}

		return { workerId: session.workerId, organizationId: session.organizationId };
	}

	/**
	 * GET /bindings — list source bindings for the session's worker.
	 */
	router.get("/bindings", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) throw new ApiError(400, "Missing session ID");

			const authOrgId = req.auth?.source === "sandbox" ? undefined : req.auth?.orgId;
			const { workerId, organizationId } = await resolveSessionWorker(sessionId, authOrgId);

			const bindings = await sourceReads.listBindings(workerId, organizationId);

			logger.debug({ sessionId, count: bindings.length }, "Listed source bindings");
			res.json({ bindings });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /query — paginated source query.
	 * Query params: bindingId (required), cursor?, limit?
	 */
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
		} catch (err) {
			if (err instanceof sourceReads.BindingNotFoundError) {
				next(new ApiError(404, err.message));
				return;
			}
			if (err instanceof sourceReads.CredentialMissingError) {
				next(new ApiError(502, err.message, { code: err.code }));
				return;
			}
			if (err instanceof sourceReads.SourceTypeUnsupportedError) {
				next(new ApiError(400, err.message, { code: err.code }));
				return;
			}
			next(err);
		}
	});

	/**
	 * GET /get — single source item detail.
	 * Query params: bindingId (required), sourceRef (required)
	 */
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
			if (!item) {
				throw new ApiError(404, "Source item not found");
			}

			logger.debug({ sessionId, bindingId, sourceRef }, "Source item retrieved");
			res.json({ item });
		} catch (err) {
			if (err instanceof sourceReads.BindingNotFoundError) {
				next(new ApiError(404, err.message));
				return;
			}
			if (err instanceof sourceReads.CredentialMissingError) {
				next(new ApiError(502, err.message, { code: err.code }));
				return;
			}
			next(err);
		}
	});

	return router;
}
