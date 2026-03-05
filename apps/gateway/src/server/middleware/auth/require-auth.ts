import type { RequestHandler } from "express";
import type { GatewayEnv } from "../../../lib/env";
import { ApiError } from "../errors/api-error";
import { getSessionIdForSandboxAuth, verifyToken } from "./token-verifier";

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader?.startsWith("Bearer ")) return null;
	return authHeader.slice(7);
}

/**
 * Create auth middleware for header-based authentication (Bearer token).
 * Used by /proliferate routes.
 */
export function createRequireAuth(env: GatewayEnv): RequestHandler {
	return async (req, _res, next) => {
		const token = extractBearerToken(req.headers.authorization);
		if (!token) {
			return next(new ApiError(401, "Missing authorization"));
		}

		const sessionId = getSessionIdForSandboxAuth(req);
		const auth = await verifyToken(token, env, sessionId);
		if (!auth) {
			return next(new ApiError(401, "Invalid token"));
		}

		req.auth = auth;
		next();
	};
}

/**
 * Create auth middleware for path-based authentication (token in URL).
 * Used by /proxy routes where SSE clients can't use headers.
 */
export function createRequireProxyAuth(env: GatewayEnv): RequestHandler {
	return async (req, _res, next) => {
		const { token } = req.params;
		if (!token) {
			return next(new ApiError(401, "Missing token in path"));
		}

		const auth = await verifyToken(token, env);
		if (!auth) {
			return next(new ApiError(401, "Invalid token"));
		}

		req.auth = auth;
		next();
	};
}
