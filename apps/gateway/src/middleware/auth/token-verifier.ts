import { createLogger } from "@proliferate/logger";
import { verifyToken as verifyJwt } from "@proliferate/shared";
import type { Request } from "express";
import type { GatewayEnv } from "../../lib/env";
import type { AuthResult } from "../../types";
import { deriveSandboxMcpToken } from "./sandbox-mcp-token";

const logger = createLogger({ service: "gateway" }).child({ module: "auth" });

export interface VerifyCliTokenResult {
	valid: boolean;
	userId?: string;
	orgId?: string;
	error?: string;
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve session ID for sandbox token checks.
 *
 * Route-level middleware runs before params are attached for nested param routes,
 * so fall back to the first URL segment when needed.
 */
export function getSessionIdForSandboxAuth(req: Request): string | undefined {
	const paramValue = req.params.proliferateSessionId;
	if (paramValue && SESSION_ID_PATTERN.test(paramValue)) {
		return paramValue;
	}

	const firstSegment = req.path.split("/").filter(Boolean)[0];
	if (firstSegment && SESSION_ID_PATTERN.test(firstSegment)) {
		return firstSegment;
	}

	return undefined;
}

/**
 * Verify a CLI API key via the web app's internal endpoint.
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
export async function verifyToken(
	token: string,
	env: GatewayEnv,
	sessionId?: string,
): Promise<AuthResult | null> {
	// User JWTs: minted by the web app for browser clients (Gateway WS auth).
	const userPayload = await verifyJwt(token, env.gatewayJwtSecret);
	if (userPayload?.sub) {
		return { userId: userPayload.sub, orgId: userPayload.orgId, source: "jwt" };
	}

	// Service JWTs: minted by backend services/workers.
	// Never treat service-secret JWTs as user identity unless explicitly marked as service.
	const servicePayload = await verifyJwt(token, env.serviceToken);
	if (servicePayload?.sub && servicePayload.service) {
		return { source: "service" };
	}

	// Sandbox HMAC token: derived from HMAC-SHA256(serviceToken, sessionId).
	// Used by the agent CLI inside the sandbox to call gateway actions.
	if (sessionId) {
		const expected = deriveSandboxMcpToken(env.serviceToken, sessionId);
		if (token === expected) {
			return { source: "sandbox", sessionId };
		}
	}

	// Try CLI API key (requires HTTP call to web app - keys stored in DB)
	const cliResult = await verifyCliToken(token, env.apiUrl, env.serviceToken);
	if (cliResult.valid && cliResult.userId) {
		return { userId: cliResult.userId, orgId: cliResult.orgId, source: "cli" };
	}

	return null;
}
