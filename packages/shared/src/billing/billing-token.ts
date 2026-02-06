/**
 * Billing token system for sandbox authentication.
 *
 * Sessions use short-lived JWTs to authenticate billing requests from sandboxes.
 * - Tokens are 1 hour lived and can be refreshed
 * - Token version in DB allows instant revocation
 * - Validates session is still running before accepting billing
 */

import { env } from "@proliferate/environment/server";
import { type JWTPayload, SignJWT, jwtVerify } from "jose";

// ============================================
// Types
// ============================================

export interface BillingTokenClaims extends JWTPayload {
	org_id: string;
	session_id: string;
	token_version: number;
}

// ============================================
// Configuration
// ============================================

const TOKEN_LIFETIME = "1h";

function getBillingSecret(): Uint8Array {
	const secret = env.BILLING_JWT_SECRET;
	if (!secret) {
		throw new Error("Missing BILLING_JWT_SECRET environment variable");
	}
	return new TextEncoder().encode(secret);
}

// ============================================
// Token Operations
// ============================================

/**
 * Mint a billing token when creating/refreshing a session.
 *
 * @param orgId - Organization ID
 * @param sessionId - Session ID
 * @param tokenVersion - Current token version from session record
 * @returns Signed JWT token
 */
export async function mintBillingToken(
	orgId: string,
	sessionId: string,
	tokenVersion: number,
): Promise<string> {
	const secret = getBillingSecret();

	return await new SignJWT({
		org_id: orgId,
		session_id: sessionId,
		token_version: tokenVersion,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(TOKEN_LIFETIME)
		.sign(secret);
}

/**
 * Verify a billing token's signature and expiry.
 * Does NOT validate against database - use validateBillingToken for full validation.
 *
 * @param token - JWT token to verify
 * @returns Decoded claims if valid
 * @throws If token is invalid or expired
 */
export async function verifyBillingToken(token: string): Promise<BillingTokenClaims> {
	const secret = getBillingSecret();

	try {
		const { payload } = await jwtVerify(token, secret);

		// Validate required claims
		if (!payload.org_id || !payload.session_id || payload.token_version === undefined) {
			throw new Error("Missing required claims in billing token");
		}

		return payload as BillingTokenClaims;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Invalid billing token: ${error.message}`);
		}
		throw new Error("Invalid billing token");
	}
}

// ============================================
// Full Validation (requires database access)
// ============================================

/**
 * Session data needed for billing token validation.
 */
export interface SessionForBillingValidation {
	id: string;
	organization_id: string;
	status: string;
	billing_token_version: number;
}

/**
 * Validate a billing token against the database.
 * Checks signature, expiry, session existence, status, and token version.
 *
 * @param token - JWT token to validate
 * @param getSession - Function to fetch session from database
 * @returns Validated claims
 * @throws If validation fails
 */
export async function validateBillingToken(
	token: string,
	getSession: (sessionId: string) => Promise<SessionForBillingValidation | null>,
): Promise<BillingTokenClaims> {
	// 1. Verify signature and expiry
	const claims = await verifyBillingToken(token);

	// 2. Fetch session from database
	const session = await getSession(claims.session_id);

	if (!session) {
		throw new Error("Session not found");
	}

	// 3. Verify session is running
	if (session.status !== "running") {
		throw new Error(`Session not running (status: ${session.status})`);
	}

	// 4. Verify org matches
	if (session.organization_id !== claims.org_id) {
		throw new Error("Organization mismatch");
	}

	// 5. Verify token version (for revocation)
	if (session.billing_token_version !== claims.token_version) {
		throw new Error("Token revoked (version mismatch)");
	}

	return claims;
}

// ============================================
// Token Extraction
// ============================================

/**
 * Extract billing token from Authorization header.
 *
 * @param authHeader - Authorization header value (e.g., "Bearer eyJ...")
 * @returns Token string or null if not present/invalid format
 */
export function extractBillingToken(authHeader: string | null): string | null {
	if (!authHeader) {
		return null;
	}

	if (!authHeader.startsWith("Bearer ")) {
		return null;
	}

	return authHeader.slice(7);
}
