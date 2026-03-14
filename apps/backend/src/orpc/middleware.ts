/**
 * oRPC middleware.
 *
 * Reusable middleware layers for auth and org resolution.
 * Uses `decorateMiddleware` so these can be passed directly to `.use()`.
 */

import {
	type Meta,
	ORPCError,
	type ORPCErrorConstructorMap,
	decorateMiddleware,
} from "@orpc/server";
import { type Auth, createAuth } from "@proliferate/auth-core";
import { orgs } from "@proliferate/services";
import { type SessionResult, getSessionFromHeaders } from "../auth/session";
import type { AuthContext, BaseContext, OrgContext } from "./context";

// ============================================
// Lazy auth instance
// ============================================

let authInstance: Auth | null = null;

function getAuth(): Auth {
	if (!authInstance) {
		authInstance = createAuth();
	}
	return authInstance;
}

// ============================================
// Session resolution helpers
// ============================================

async function resolveSession(request: Request): Promise<SessionResult> {
	const session = await getSessionFromHeaders(getAuth(), request.headers);
	if (!session) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}
	return session;
}

async function resolveSessionWithOrg(request: Request): Promise<SessionResult & { orgId: string }> {
	const session = await resolveSession(request);

	const orgId = session.session.activeOrganizationId;
	if (!orgId) {
		throw new ORPCError("BAD_REQUEST", { message: "No active organization" });
	}

	const isMember = await orgs.isMember(session.user.id, orgId);
	if (!isMember) {
		throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
	}

	return { ...session, orgId };
}

// ============================================
// Reusable middleware
// ============================================

/**
 * Requires a valid session. Adds `user` and `session` to context.
 */
export const protectedMiddleware = decorateMiddleware<
	BaseContext,
	Omit<AuthContext, "request">,
	any,
	any,
	ORPCErrorConstructorMap<any>,
	Meta
>(async ({ context, next }) => {
	const s = await resolveSession(context.request);
	return next({ context: { user: s.user, session: s.session } });
});

/**
 * Requires a valid session + active org membership. Adds `user`, `session`, and `orgId` to context.
 */
export const orgMiddleware = decorateMiddleware<
	BaseContext,
	Omit<OrgContext, "request">,
	any,
	any,
	ORPCErrorConstructorMap<any>,
	Meta
>(async ({ context, next }) => {
	const r = await resolveSessionWithOrg(context.request);
	return next({ context: { user: r.user, session: r.session, orgId: r.orgId } });
});
