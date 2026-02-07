/**
 * Auth Middleware
 *
 * Unified authentication for all gateway routes.
 * Supports both JWT tokens (web clients) and CLI API keys.
 */

import { createLogger } from "@proliferate/logger";
import { verifyToken as verifyJwt } from "@proliferate/shared";
import type { RequestHandler } from "express";
import type { GatewayEnv } from "../lib/env";
import type { AuthResult } from "../types";
import { ApiError } from "./error-handler";

const logger = createLogger({ service: "gateway" }).child({ module: "auth" });

/**
 * CLI token verification result
 */
export interface VerifyCliTokenResult {
	valid: boolean;
	userId?: string;
	orgId?: string;
	error?: string;
}

/**
 * Verify a CLI API key via the web app's internal endpoint.
 * CLI tokens are better-auth API keys stored in the database.
 */
export async function verifyCliToken(
	token: string,
	apiUrl: string,
	serviceToken: string,
): Promise<VerifyCliTokenResult> {
	try {
		const url = `${apiUrl}/api/internal/verify-cli-token`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-service-token": serviceToken,
			},
			body: JSON.stringify({ token }),
		});

		return (await response.json()) as VerifyCliTokenResult;
	} catch (err) {
		logger.error({ err }, "Failed to verify CLI token");
		return { valid: false, error: "Token verification failed" };
	}
}

/**
 * Verify a token (JWT or CLI API key) and return auth result.
 */
export async function verifyToken(token: string, env: GatewayEnv): Promise<AuthResult | null> {
	// User JWTs: minted by the web app for browser clients (Gateway WS auth).
	const userPayload = await verifyJwt(token, env.gatewayJwtSecret);
	if (userPayload?.sub) {
		return { userId: userPayload.sub, source: "jwt" };
	}

	// Service JWTs: minted by backend services/workers.
	// Never treat service-secret JWTs as user identity unless explicitly marked as service.
	const servicePayload = await verifyJwt(token, env.serviceToken);
	if (servicePayload?.sub && servicePayload.service) {
		return { source: "service" };
	}

	// Try CLI API key (requires HTTP call to web app - keys stored in DB)
	const cliResult = await verifyCliToken(token, env.apiUrl, env.serviceToken);
	if (cliResult.valid && cliResult.userId) {
		return { userId: cliResult.userId, orgId: cliResult.orgId, source: "cli" };
	}

	return null;
}

/**
 * Extract bearer token from Authorization header
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

		const auth = await verifyToken(token, env);
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
