/**
 * oRPC middleware and base procedures.
 */

import {
	type ImpersonationContext,
	getSession,
	isAuthError,
	requireAuth,
} from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { isSuperAdmin } from "@/lib/super-admin";
import { os, ORPCError } from "@orpc/server";
import { nodeEnv, runtimeEnv } from "@proliferate/environment/runtime";
import { orgs } from "@proliferate/services";
import { BillingGateError } from "@proliferate/shared/billing";

const log = logger.child({ module: "orpc-middleware" });
const enableTimingLogs = nodeEnv === "development" && runtimeEnv.ORPC_TIMING !== "0";

const slowTotalThresholdMs = Number(runtimeEnv.ORPC_SLOW_TOTAL_MS ?? 1500);
const slowAuthThresholdMs = Number(runtimeEnv.ORPC_SLOW_AUTH_MS ?? 1000);
const slowEventLoopThresholdMs = Number(runtimeEnv.ORPC_SLOW_EVENT_LOOP_MS ?? 100);

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

export interface AdminContext {
	user: {
		id: string;
		email: string;
		name: string;
	};
	sessionId: string;
}

function createRequestId() {
	return Math.random().toString(36).slice(2, 8);
}

async function measureEventLoopLagMs() {
	const startedAt = performance.now();
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
	return performance.now() - startedAt;
}

function maybeLogTiming(details: {
	requestId: string;
	stage: "protected" | "org";
	path: readonly string[];
	eventLoopLagMs: number;
	authMs: number;
	totalMs: number;
	status: "ok" | "auth_error";
	error?: string;
}) {
	if (!enableTimingLogs) {
		return;
	}

	const isSlow =
		details.totalMs >= slowTotalThresholdMs ||
		details.authMs >= slowAuthThresholdMs ||
		details.eventLoopLagMs >= slowEventLoopThresholdMs;

	if (!isSlow) {
		return;
	}

	log.warn(
		{
			requestId: details.requestId,
			stage: details.stage,
			path: details.path.join("/"),
			status: details.status,
			eventLoopLagMs: Number(details.eventLoopLagMs.toFixed(1)),
			authMs: Number(details.authMs.toFixed(1)),
			totalMs: Number(details.totalMs.toFixed(1)),
			error: details.error,
		},
		"Slow oRPC auth middleware",
	);
}

// ============================================
// Base procedure (no auth required)
// ============================================

export const publicProcedure = os;

// ============================================
// Protected procedure (auth required)
// ============================================

export const protectedProcedure = os.use(async ({ next, path }) => {
	const requestId = createRequestId();
	const startedAt = performance.now();
	const eventLoopLagMs = await measureEventLoopLagMs();
	const authStartedAt = performance.now();
	const authResult = await requireAuth();
	const authMs = performance.now() - authStartedAt;
	const totalMs = performance.now() - startedAt;

	if (isAuthError(authResult)) {
		maybeLogTiming({
			requestId,
			stage: "protected",
			path,
			eventLoopLagMs,
			authMs,
			totalMs,
			status: "auth_error",
			error: authResult.error,
		});

		throw new ORPCError(authResult.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", {
			message: authResult.error,
		});
	}

	maybeLogTiming({
		requestId,
		stage: "protected",
		path,
		eventLoopLagMs,
		authMs,
		totalMs,
		status: "ok",
	});

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

export const orgProcedure = os.use(async ({ next, path }) => {
	const requestId = createRequestId();
	const startedAt = performance.now();
	const eventLoopLagMs = await measureEventLoopLagMs();
	const authStartedAt = performance.now();
	const authResult = await requireAuth();
	const authMs = performance.now() - authStartedAt;
	const totalMs = performance.now() - startedAt;

	if (isAuthError(authResult)) {
		maybeLogTiming({
			requestId,
			stage: "org",
			path,
			eventLoopLagMs,
			authMs,
			totalMs,
			status: "auth_error",
			error: authResult.error,
		});

		throw new ORPCError(authResult.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", {
			message: authResult.error,
		});
	}

	maybeLogTiming({
		requestId,
		stage: "org",
		path,
		eventLoopLagMs,
		authMs,
		totalMs,
		status: "ok",
	});

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No active organization",
		});
	}

	// Verify the user is still a member of the active org (catches stale sessions)
	const isMember = await orgs.isMember(authResult.session.user.id, orgId);
	if (!isMember) {
		throw new ORPCError("NOT_FOUND", {
			message: "Organization not found",
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

// ============================================
// Billing-gated procedure (org + billing gate)
// ============================================

export const billingGatedProcedure = orgProcedure.use(async ({ next }) => {
	try {
		return await next();
	} catch (err) {
		if (err instanceof BillingGateError) {
			throw new ORPCError("PAYMENT_REQUIRED", {
				message: err.message,
				data: { billingCode: err.code },
			});
		}
		throw err;
	}
});

// ============================================
// Admin procedure (super admin only)
// ============================================

export const adminProcedure = os.use(async ({ next }) => {
	const session = await getSession();

	if (!session?.user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}

	if (!isSuperAdmin(session.user.email)) {
		throw new ORPCError("FORBIDDEN", { message: "Forbidden" });
	}

	return next({
		context: {
			user: session.user,
			sessionId: session.session.id,
		} satisfies AdminContext,
	});
});
