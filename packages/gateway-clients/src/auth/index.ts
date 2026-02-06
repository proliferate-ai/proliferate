/**
 * Auth Utilities
 *
 * Token signing and auth configuration.
 */

import { signServiceToken } from "@proliferate/shared/auth";

/**
 * Service-to-service auth (workers, API routes)
 * SDK handles JWT signing internally
 */
export interface ServiceAuth {
	type: "service";
	/** Service name for the JWT subject (e.g., "slack-worker") */
	name: string;
	/** Shared secret for HS256 signing */
	secret: string;
}

/**
 * User token auth (browser clients)
 * Token is passed directly
 */
export interface TokenAuth {
	type: "token";
	/** User's auth token (e.g., from /api/auth/ws-token) */
	token: string;
}

/**
 * Auth configuration - either service auth (JWT signing) or user token
 */
export type GatewayAuth = ServiceAuth | TokenAuth;

/**
 * Token getter function type
 */
export type TokenGetter = () => Promise<string>;

/**
 * Create a token getter from auth config
 */
export function createTokenGetter(auth: GatewayAuth): TokenGetter {
	if (auth.type === "service") {
		return () => signServiceToken(auth.name, auth.secret);
	}
	return () => Promise.resolve(auth.token);
}

/**
 * Build authorization header value
 */
export function buildAuthHeader(token: string): string {
	return `Bearer ${token}`;
}
