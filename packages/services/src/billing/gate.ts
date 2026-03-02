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
	parseBillingSettings,
} from "@proliferate/shared/billing";
import { getServicesLogger } from "../logger";
import { expireGraceForOrg, getBillingInfoV2 } from "../orgs/service";
import { getSessionCountsByOrganization } from "../sessions/service";
import { getActiveCoworkerCount, getMonthlyUsageTotal } from "./db";

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

	// Fetch coworker count and monthly usage (best-effort, non-blocking)
	let activeCoworkerCount: number | undefined;
	let monthlyUsage: number | undefined;
	try {
		[activeCoworkerCount, monthlyUsage] = await Promise.all([
			getActiveCoworkerCount(orgId),
			getMonthlyUsageTotal(orgId),
		]);
	} catch (err) {
		log.warn({ err }, "Could not load coworker count or monthly usage for gate");
		// Non-critical: proceed without these checks
	}

	// Build pure-gate input
	const planId = resolvePlan(org.billingPlan);
	const billingSettings = parseBillingSettings(org.billingSettings);
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
					maxActiveCoworkers: PLAN_CONFIGS[planId].maxActiveCoworkers,
					creditsIncluded: PLAN_CONFIGS[planId].creditsIncluded,
				}
			: null,
		overagePolicy: billingSettings.overage_policy,
	};

	const gateResult = checkBillingGate(orgBillingInfo, {
		operation,
		sessionCounts,
		minCreditsRequired: MIN_CREDITS_TO_START,
		activeCoworkerCount,
		monthlyUsage,
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
 * Get entitlement status for the org (used by billing UI for limit display).
 *
 * Returns null when billing is disabled.
 */
export async function getEntitlementStatus(orgId: string): Promise<{
	concurrentSessions: { current: number; max: number };
	activeCoworkers: { current: number; max: number };
	monthlyUsage: { used: number; included: number; warningLevel: string };
} | null> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return null;
	}

	const { computeWarningLevel } = await import("@proliferate/shared/billing");
	const log = getServicesLogger().child({ module: "billing-gate", orgId });

	try {
		const [org, sessionCounts, coworkerCount, monthlyUsage] = await Promise.all([
			getBillingInfoV2(orgId),
			getSessionCountsByOrganization(orgId),
			getActiveCoworkerCount(orgId),
			getMonthlyUsageTotal(orgId),
		]);

		const planId = resolvePlan(org?.billingPlan);
		const config = planId ? PLAN_CONFIGS[planId] : null;

		return {
			concurrentSessions: {
				current: sessionCounts.running,
				max: config?.maxConcurrentSessions ?? 1,
			},
			activeCoworkers: {
				current: coworkerCount,
				max: config?.maxActiveCoworkers ?? 1,
			},
			monthlyUsage: {
				used: monthlyUsage,
				included: config?.creditsIncluded ?? 0,
				warningLevel: computeWarningLevel(monthlyUsage, config?.creditsIncluded ?? 0),
			},
		};
	} catch (err) {
		log.error({ err }, "Failed to compute entitlement status");
		return null;
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
