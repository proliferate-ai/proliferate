/**
 * Billing utilities for API routes (V2).
 *
 * These helpers handle credit checks and session gating.
 *
 * V2 Changes:
 * - Uses shadow balance (local DB) instead of Autumn API calls in hot path
 * - Fail-closed on errors (not fail-open)
 * - Unified gating for all session operations
 */

import { env } from "@proliferate/environment/server";
import { orgs, sessions } from "@proliferate/services";
import {
	type BillingPlan,
	type BillingState,
	type GatedOperation,
	MIN_CREDITS_TO_START,
	type OrgBillingInfo,
	PLAN_CONFIGS,
	checkBillingGate,
} from "@proliferate/shared/billing";

// ============================================
// Types
// ============================================

export type BillingErrorCode =
	| "NO_CREDITS"
	| "CONCURRENT_LIMIT"
	| "BILLING_NOT_CONFIGURED"
	| "STATE_BLOCKED"
	| "GRACE_EXPIRED";

export interface BillingCheckResult {
	allowed: boolean;
	error?: string;
	code?: BillingErrorCode;
	message?: string;
	/** Action to take if not allowed */
	action?: "block" | "terminate_sessions";
}

// ============================================
// Configuration
// ============================================

/**
 * Check if billing system is enabled.
 * When disabled, all credit checks pass.
 */
export function isBillingEnabled(): boolean {
	return env.NEXT_PUBLIC_BILLING_ENABLED;
}

// ============================================
// Session Gating (V2)
// ============================================

/**
 * Check if organization can start a new session.
 *
 * V2: Uses unified gating with shadow balance (no Autumn calls in hot path).
 * FAIL-CLOSED: Returns false on errors instead of allowing through.
 *
 * Validates:
 * 1. Billing state allows starting sessions
 * 2. Shadow balance has sufficient credits
 * 3. Organization is under concurrent session limit
 *
 * @returns { allowed: true } or { allowed: false, error, code, message }
 */
export async function checkCanStartSession(
	orgId: string,
	operation: GatedOperation = "session_start",
): Promise<BillingCheckResult> {
	// If billing is not configured, allow all sessions
	if (!isBillingEnabled()) {
		return { allowed: true };
	}

	// Get org billing info (including shadow balance)
	const org = await orgs.getBillingInfoV2(orgId);

	if (!org) {
		console.error(`[Billing] FAIL-CLOSED: Failed to fetch org ${orgId}`);
		return {
			allowed: false,
			error: "Failed to verify billing status",
			code: "BILLING_NOT_CONFIGURED",
			message: "Unable to verify billing status. Please try again.",
		};
	}

	// Get session counts for concurrency check
	const sessionCounts = await sessions.getSessionCountsByOrganization(orgId);

	// Build org billing info for gate check
	const planId: BillingPlan | null =
		org.billingPlan === "dev" || org.billingPlan === "pro" ? org.billingPlan : null;
	const planLimits = planId
		? {
				maxConcurrentSessions: PLAN_CONFIGS[planId].maxConcurrentSessions,
				creditsIncluded: PLAN_CONFIGS[planId].creditsIncluded,
			}
		: null;
	const orgBillingInfo: OrgBillingInfo = {
		id: org.id,
		billingState: org.billingState as BillingState,
		shadowBalance: Number(org.shadowBalance ?? 0),
		graceExpiresAt: org.graceExpiresAt,
		autumnCustomerId: org.autumnCustomerId,
		planId,
		planLimits,
		// Plan limits would be cached from Autumn - using defaults for now
	};

	// Run unified gate check
	const gateResult = checkBillingGate(orgBillingInfo, {
		operation,
		sessionCounts: {
			running: sessionCounts.running,
			paused: sessionCounts.paused,
		},
		minCreditsRequired: MIN_CREDITS_TO_START,
	});

	if (!gateResult.allowed) {
		if (gateResult.errorCode === "GRACE_EXPIRED") {
			try {
				await orgs.expireGraceForOrg(orgId);
			} catch (err) {
				console.error(`[Billing] Failed to expire grace for org ${orgId}:`, err);
			}
		}
		return {
			allowed: false,
			error: gateResult.message,
			code: gateResult.errorCode,
			message: gateResult.message,
			action: gateResult.action,
		};
	}

	return { allowed: true };
}

/**
 * Check if organization can resume a session.
 * Similar to start but uses session_resume operation.
 */
export async function checkCanResumeSession(orgId: string): Promise<BillingCheckResult> {
	return checkCanStartSession(orgId, "session_resume");
}

/**
 * Check if CLI can connect.
 * Similar to start but uses cli_connect operation.
 */
export async function checkCanConnectCLI(orgId: string): Promise<BillingCheckResult> {
	return checkCanStartSession(orgId, "cli_connect");
}

/**
 * Get billing status for an organization.
 * Used by the dashboard to show credit balance and plan info.
 */
export async function getOrgBillingStatus(orgId: string): Promise<{
	configured: boolean;
	credits?: { balance: number; usage: number; included: number };
	plan?: string;
}> {
	if (!isBillingEnabled()) {
		return { configured: false };
	}

	const org = await orgs.getBillingInfo(orgId);

	if (!org?.autumnCustomerId) {
		return { configured: false };
	}

	try {
		const { autumnGetCustomer } = await import("@proliferate/shared/billing");

		const customer = await autumnGetCustomer(org.autumnCustomerId);

		const creditsFeature = customer.features?.credits;

		const activeProduct = customer.products?.find((p) => p.status === "active");
		return {
			configured: true,
			credits: creditsFeature
				? {
						balance: creditsFeature.balance ?? 0,
						usage: creditsFeature.usage ?? 0,
						included: creditsFeature.included_usage ?? 0,
					}
				: undefined,
			plan: activeProduct?.id ?? undefined,
		};
	} catch (err) {
		console.error(`[Billing] Failed to get billing status for org ${orgId}:`, err);
		return { configured: false };
	}
}
