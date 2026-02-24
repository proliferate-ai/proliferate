import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getImpersonationCookie, isSuperAdmin } from "@/lib/super-admin";

const log = logger.child({ module: "auth-helpers" });
import { nodeEnv } from "@proliferate/environment/runtime";
import { env } from "@proliferate/environment/server";
import { orgs, users } from "@proliferate/services";
import { headers } from "next/headers";

export interface SessionResult {
	user: {
		id: string;
		email: string;
		name: string;
	};
	session: {
		id: string;
		activeOrganizationId?: string | null;
	};
}

/**
 * Returns the DEV_USER_ID when the dev bypass is active, otherwise undefined.
 * Active when: DEV_USER_ID is set and not "disabled", not production, not CI.
 */
export function getDevUserId(): string | undefined {
	const devUserId = env.DEV_USER_ID;
	if (devUserId && devUserId !== "disabled" && nodeEnv !== "production" && !env.CI) {
		return devUserId;
	}
	return undefined;
}

/**
 * Returns a mock session for the DEV_USER_ID user, or null if dev bypass is inactive.
 */
async function getDevBypassSession(): Promise<SessionResult | null> {
	const devUserId = getDevUserId();
	if (!devUserId) return null;

	const user = await users.findById(devUserId);
	if (!user) {
		log.error({ devUserId }, "DEV MODE: User not found");
		return null;
	}

	const orgId = await orgs.getFirstOrgIdForUser(devUserId);

	return {
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
		},
		session: {
			id: `dev-session-${devUserId}`,
			activeOrganizationId: orgId ?? null,
		},
	};
}

/**
 * Check for API key in Authorization header and return user if valid
 */
async function getApiKeyUser(): Promise<SessionResult | null> {
	const headersList = await headers();
	const authorization = headersList.get("authorization");

	if (!authorization?.startsWith("Bearer ")) {
		return null;
	}

	const apiKey = authorization.replace("Bearer ", "");

	// CLI can pass org ID in X-Org-Id header (from ~/.proliferate/token)
	const orgIdHeader = headersList.get("x-org-id");

	try {
		const result = await auth.api.verifyApiKey({
			body: { key: apiKey },
		});

		if (!result.valid || !result.key) {
			return null;
		}

		// Get user details from the API key
		const user = await users.findById(result.key.userId);

		if (!user) {
			return null;
		}

		let orgId: string | null = null;

		// If CLI passed an org ID, verify user is a member of that org
		if (orgIdHeader) {
			const role = await orgs.getUserRole(user.id, orgIdHeader);
			if (!role) {
				log.warn(
					{ userId: user.id, orgId: orgIdHeader },
					"API key org header is not authorized for user",
				);
				return null;
			}
			orgId = orgIdHeader;
		}

		// Fallback: get first org (for backwards compatibility)
		if (!orgId) {
			orgId = await orgs.getFirstOrgIdForUser(user.id);
		}

		return {
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
			},
			session: {
				id: `apikey-${result.key.id}`,
				activeOrganizationId: orgId,
			},
		};
	} catch (error) {
		log.error({ err: error }, "API key verification failed");
		return null;
	}
}

export interface ImpersonationContext {
	realUserId: string;
	realUserEmail: string;
}

interface AuthResult {
	session: {
		user: {
			id: string;
			email: string;
			name: string;
		};
		session: {
			id: string;
			activeOrganizationId?: string;
		};
	};
	impersonation?: ImpersonationContext;
	error?: never;
	status?: never;
}

interface AuthError {
	session?: never;
	error: string;
	status: 400 | 401 | 403;
}

export type RequireAuthResult = AuthResult | AuthError;

/**
 * Type guard to check if auth result is an error.
 * Provides proper type narrowing for TypeScript.
 */
export function isAuthError(result: RequireAuthResult): result is AuthError {
	return "error" in result && typeof result.error === "string";
}

/**
 * Helper to create ts-rest compatible auth error responses.
 * Use this in ts-rest routers to avoid unsafe type casting.
 *
 * Usage:
 *   const authResult = await requireAuth();
 *   if (isAuthError(authResult)) {
 *     return authErrorResponse(authResult);
 *   }
 */
export function authErrorResponse(authResult: AuthError) {
	return {
		status: authResult.status,
		body: { error: authResult.error },
	} as const;
}

/**
 * Get the current session from better-auth
 * Use this in Route Handlers
 *
 * Supports:
 * 1. Dev mode bypass (DEV_USER_ID env var)
 * 2. API key authentication (Bearer token in Authorization header)
 * 3. Cookie-based session authentication
 */
export async function getSession() {
	// Dev mode bypass - always return this user as logged in
	const devSession = await getDevBypassSession();
	if (devSession) return devSession;

	// Check for API key authentication (CLI tokens)
	const apiKeySession = await getApiKeyUser();
	if (apiKeySession) return apiKeySession;

	// Normal cookie-based auth flow
	const headersList = await headers();
	return auth.api.getSession({
		headers: headersList as unknown as Headers,
	});
}

/**
 * Require authentication - returns session or error
 * Use this in Route Handlers that need authentication
 *
 * If the authenticated user is a super-admin and has an impersonation cookie set,
 * returns the impersonated user's context instead, with impersonation metadata.
 */
export async function requireAuth(): Promise<RequireAuthResult> {
	const session = await getSession();

	if (!session?.user) {
		return { error: "Unauthorized", status: 401 };
	}

	const realUser = session.user;
	let effectiveUser = realUser;
	let effectiveOrgId = session.session.activeOrganizationId;
	let impersonation: ImpersonationContext | undefined;

	// Check for super-admin impersonation
	if (isSuperAdmin(realUser.email)) {
		const impersonationData = await getImpersonationCookie();
		if (impersonationData) {
			const impersonatedUser = await users.findById(impersonationData.userId);

			if (impersonatedUser) {
				effectiveUser = impersonatedUser;
				effectiveOrgId = impersonationData.orgId;
				impersonation = { realUserId: realUser.id, realUserEmail: realUser.email };
			}
		}
	}

	return {
		session: {
			user: {
				id: effectiveUser.id,
				email: effectiveUser.email,
				name: effectiveUser.name,
			},
			session: {
				id: session.session.id,
				activeOrganizationId: effectiveOrgId ?? undefined,
			},
		},
		impersonation,
	};
}

interface OrgAuthResult {
	session: AuthResult["session"];
	orgId: string;
	impersonation?: ImpersonationContext;
	error?: never;
	status?: never;
}

export type RequireOrgAuthResult = OrgAuthResult | AuthError;

/**
 * Require authentication + verified org membership.
 * Mirrors `orgProcedure` semantics for non-oRPC route handlers:
 * - 401 if not authenticated
 * - 400 if no active organization
 * - 403 if user is not a member of the active organization
 */
export async function requireOrgAuth(): Promise<RequireOrgAuthResult> {
	const authResult = await requireAuth();
	if (isAuthError(authResult)) return authResult;

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return { error: "No active organization", status: 400 };
	}

	const role = await orgs.getUserRole(authResult.session.user.id, orgId);
	if (!role) {
		return { error: "Not a member of this organization", status: 403 };
	}

	return {
		session: authResult.session,
		orgId,
		impersonation: authResult.impersonation,
	};
}

/**
 * Get the active organization ID for the current session
 */
export async function getActiveOrgId(): Promise<string | null> {
	const session = await getSession();
	return session?.session?.activeOrganizationId ?? null;
}
