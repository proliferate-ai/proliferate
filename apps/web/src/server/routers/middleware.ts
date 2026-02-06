/**
 * oRPC middleware and base procedures.
 */

import { type ImpersonationContext, isAuthError, requireAuth } from "@/lib/auth-helpers";
import { os, ORPCError } from "@orpc/server";

// ============================================
// Context Types
// ============================================

export interface AuthContext {
	user: {
		id: string;
		email: string;
		name: string;
	};
	session: {
		id: string;
		activeOrganizationId?: string;
	};
	impersonation: ImpersonationContext | undefined;
}

export interface OrgContext extends AuthContext {
	orgId: string;
}

// ============================================
// Base procedure (no auth required)
// ============================================

export const publicProcedure = os;

// ============================================
// Protected procedure (auth required)
// ============================================

export const protectedProcedure = os.use(async ({ next }) => {
	const authResult = await requireAuth();

	if (isAuthError(authResult)) {
		throw new ORPCError(authResult.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", {
			message: authResult.error,
		});
	}

	return next({
		context: {
			user: authResult.session.user,
			session: authResult.session.session,
			impersonation: authResult.impersonation,
		} satisfies AuthContext,
	});
});

// ============================================
// Org procedure (auth + active org required)
// ============================================

export const orgProcedure = os.use(async ({ next }) => {
	const authResult = await requireAuth();

	if (isAuthError(authResult)) {
		throw new ORPCError(authResult.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", {
			message: authResult.error,
		});
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No active organization",
		});
	}

	return next({
		context: {
			user: authResult.session.user,
			session: authResult.session.session,
			impersonation: authResult.impersonation,
			orgId,
		} satisfies OrgContext,
	});
});
