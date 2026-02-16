/**
 * Domain billing gate (Iron Door).
 *
 * DB-backed gating that wraps the pure gate from @proliferate/shared/billing/gating.
 * Single enforcement point for all session lifecycle operations.
 *
 * Fail-closed: on any error, the operation is denied.
 */

import { env } from "@proliferate/environment/server";
import {
	BillingGateError,
	type BillingGateResult,
	type BillingPlan,
	type BillingState,
	type GatedOperation,
	MIN_CREDITS_TO_START,
	type OrgBillingInfo,
	PLAN_CONFIGS,
	checkBillingGate,
} from "@proliferate/shared/billing";
import { getServicesLogger } from "../logger";
import { expireGraceForOrg, getBillingInfoV2 } from "../orgs/service";
import { getSessionCountsByOrganization } from "../sessions/service";

// Re-export types so callers can use `billing.BillingGateError` etc.
export {
	BillingGateError,
	type BillingGateResult,
	type BillingErrorCode,
} from "@proliferate/shared/billing";

// ============================================
// Helpers
// ============================================

/** Fail-closed denial for infrastructure / lookup errors. */
function deny(error: string): BillingGateResult {
	return {
		allowed: false,
		error,
		code: "BILLING_NOT_CONFIGURED",
		message: "Unable to verify billing status. Please try again.",
	};
}

/** Resolve a billing plan ID from the raw DB value. */
function resolvePlan(raw: string | null | undefined): BillingPlan | null {
	return raw === "dev" || raw === "pro" ? raw : null;
}

// ============================================
// Gate Functions
// ============================================

/**
 * Check if an org is allowed to perform a billing-gated operation.
 *
 * No-op when billing is disabled.
 * Fail-closed: returns `{ allowed: false }` on any DB or lookup error.
 */
export async function checkBillingGateForOrg(
	orgId: string,
	operation: GatedOperation = "session_start",
): Promise<BillingGateResult> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return { allowed: true };
	}

	const log = getServicesLogger().child({ module: "billing-gate", orgId });

	// Fetch org billing info (fail-closed)
	let org: NonNullable<Awaited<ReturnType<typeof getBillingInfoV2>>>;
	try {
		const result = await getBillingInfoV2(orgId);
		if (!result) {
			log.error("FAIL-CLOSED: org not found");
			return deny("Failed to verify billing status");
		}
		org = result;
	} catch (err) {
		log.error({ err }, "FAIL-CLOSED: could not load org billing info");
		return deny("Failed to verify billing status");
	}

	// Fetch session counts (fail-closed)
	let sessionCounts: { running: number; paused: number };
	try {
		sessionCounts = await getSessionCountsByOrganization(orgId);
	} catch (err) {
		log.error({ err }, "FAIL-CLOSED: could not load session counts");
		return deny("Failed to verify session counts");
	}

	// Build pure-gate input
	const planId = resolvePlan(org.billingPlan);
	const orgBillingInfo: OrgBillingInfo = {
		id: org.id,
		billingState: org.billingState as BillingState,
		shadowBalance: Number(org.shadowBalance ?? 0),
		graceExpiresAt: org.graceExpiresAt,
		autumnCustomerId: org.autumnCustomerId,
		planId,
		planLimits: planId
			? {
					maxConcurrentSessions: PLAN_CONFIGS[planId].maxConcurrentSessions,
					creditsIncluded: PLAN_CONFIGS[planId].creditsIncluded,
				}
			: null,
	};

	const gateResult = checkBillingGate(orgBillingInfo, {
		operation,
		sessionCounts,
		minCreditsRequired: MIN_CREDITS_TO_START,
	});

	if (!gateResult.allowed) {
		// Best-effort side-effect: transition org out of grace
		if (gateResult.errorCode === "GRACE_EXPIRED") {
			try {
				await expireGraceForOrg(orgId);
			} catch (err) {
				log.error({ err }, "Failed to expire grace for org");
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
 * Assert that an org passes the billing gate.
 * Throws BillingGateError on denial. No-op when billing is disabled.
 */
export async function assertBillingGateForOrg(
	orgId: string,
	operation: GatedOperation = "session_start",
): Promise<void> {
	const result = await checkBillingGateForOrg(orgId, operation);
	if (!result.allowed) {
		throw new BillingGateError(
			result.message ?? "Billing check failed",
			result.code ?? "STATE_BLOCKED",
		);
	}
}

/**
 * Get the org's plan limits for concurrent session admission.
 *
 * Returns null when billing is disabled (no limit enforcement needed).
 * Used by session creation flows to pass limits to the atomic admission guard.
 */
export async function getOrgPlanLimits(
	orgId: string,
): Promise<{ maxConcurrentSessions: number } | null> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return null;
	}

	const log = getServicesLogger().child({ module: "billing-gate", orgId });

	let org: NonNullable<Awaited<ReturnType<typeof getBillingInfoV2>>>;
	try {
		const result = await getBillingInfoV2(orgId);
		if (!result) {
			log.error("FAIL-CLOSED: org not found for plan limits");
			// Fail-closed: enforce most restrictive default
			return { maxConcurrentSessions: 1 };
		}
		org = result;
	} catch (err) {
		log.error({ err }, "FAIL-CLOSED: could not load org for plan limits");
		return { maxConcurrentSessions: 1 };
	}

	const planId = resolvePlan(org.billingPlan);
	if (planId && PLAN_CONFIGS[planId]) {
		return { maxConcurrentSessions: PLAN_CONFIGS[planId].maxConcurrentSessions };
	}

	// No plan configured — use conservative default
	return { maxConcurrentSessions: 1 };
}
