/**
 * Unified Billing Gating (V2)
 *
 * Single gate function for all session operations:
 * - session_start
 * - session_resume
 * - cli_connect
 * - automation_trigger
 *
 * Key principles:
 * - Fail-closed after grace expires
 * - No Autumn calls in hot path (use locally persisted plan limits)
 * - Block if running sessions >= limit
 */

import {
	canStartSessionsInState,
	getStateMessage,
	isGraceExpired,
	shouldPauseSessionsInState,
} from "./state";
import {
	type BillingPlan,
	type BillingState,
	type GatedOperation,
	type GatingResult,
	PLAN_CONFIGS,
} from "./types";

// ============================================
// Types
// ============================================

/**
 * Organization billing info needed for gating.
 */
export interface OrgBillingInfo {
	id: string;
	billingState: BillingState;
	shadowBalance: number;
	graceExpiresAt: Date | null;
	autumnCustomerId: string | null;
	/** Selected plan (dev/pro) */
	planId?: BillingPlan | null;
	/** Locally cached plan limits (from Autumn) */
	planLimits?: {
		maxConcurrentSessions: number;
		maxActiveCoworkers: number;
		creditsIncluded: number;
	} | null;
	/** Overage policy for monthly limit check */
	overagePolicy?: "pause" | "allow" | null;
}

/**
 * Session counts for concurrency checking.
 */
export interface SessionCounts {
	running: number;
	paused: number;
}

/**
 * Options for the gate check.
 */
export interface GateCheckOptions {
	/** The operation being attempted */
	operation: GatedOperation;
	/** Current session counts for the org */
	sessionCounts: SessionCounts;
	/** Minimum credits required to start (default: 11) */
	minCreditsRequired?: number;
	/** Active coworker count for coworker limit check */
	activeCoworkerCount?: number;
	/** Monthly usage credits consumed so far */
	monthlyUsage?: number;
}

/**
 * Extended gating result with more context.
 */
export interface ExtendedGatingResult extends GatingResult {
	/** Specific error code if not allowed */
	errorCode?:
		| "NO_CREDITS"
		| "CONCURRENT_LIMIT"
		| "COWORKER_LIMIT"
		| "MONTHLY_LIMIT"
		| "STATE_BLOCKED"
		| "GRACE_EXPIRED";
	/** Whether this is a terminal error (can't be fixed by waiting) */
	terminal?: boolean;
}

// ============================================
// Configuration
// ============================================

/**
 * Minimum credits required to start a session.
 * Represents 11 minutes of compute time (10 + 1 buffer for final metering cycle).
 */
export const MIN_CREDITS_TO_START = 11;

/**
 * Default plan limits when Autumn data is unavailable.
 * These are conservative limits to prevent abuse.
 */
export const DEFAULT_PLAN_LIMITS = {
	maxConcurrentSessions: 1,
	creditsIncluded: 0,
};

// ============================================
// Unified Gate Function
// ============================================

/**
 * Check if an operation is allowed for the given organization.
 * This is the single entry point for all billing gating.
 *
 * FAIL-CLOSED: This function returns `allowed: false` when:
 * - Billing state prevents operation (exhausted, suspended)
 * - Grace period has expired
 * - Insufficient credits
 * - Concurrent session limit reached
 *
 * @param org - Organization billing info
 * @param options - Gate check options
 * @returns Gating result
 */
export function checkBillingGate(
	org: OrgBillingInfo,
	options: GateCheckOptions,
): ExtendedGatingResult {
	const { operation, sessionCounts, minCreditsRequired = MIN_CREDITS_TO_START } = options;
	const { billingState, shadowBalance, graceExpiresAt } = org;

	// Step 1: Check if grace period has expired (FAIL-CLOSED)
	if (billingState === "grace" && isGraceExpired(graceExpiresAt)) {
		return {
			allowed: false,
			billingState: "exhausted", // Effective state
			shadowBalance,
			message: "Grace period expired. Add credits to continue.",
			action: "pause_sessions",
			errorCode: "GRACE_EXPIRED",
			terminal: false, // Can be fixed by adding credits
		};
	}

	// Step 2: Check billing state
	if (!canStartSessionsInState(billingState)) {
		return {
			allowed: false,
			billingState,
			shadowBalance,
			message: getStateMessage(billingState, { graceExpiresAt, shadowBalance }),
			action: shouldPauseSessionsInState(billingState) ? "pause_sessions" : "block",
			errorCode: "STATE_BLOCKED",
			terminal: billingState === "suspended", // Suspended requires manual intervention
		};
	}

	// Step 3: Check shadow balance for active/trial states
	// Resume/connect operations skip the credit minimum — the session already exists,
	// so we only need state-level checks (Steps 1-2) to block truly denied orgs.
	if (
		(operation === "session_start" || operation === "automation_trigger") &&
		(billingState === "active" || billingState === "trial")
	) {
		if (shadowBalance < minCreditsRequired) {
			return {
				allowed: false,
				billingState,
				shadowBalance,
				message: `Insufficient credits. You need at least ${minCreditsRequired} credits to ${getOperationDescription(operation)}.`,
				action: "block",
				errorCode: "NO_CREDITS",
				terminal: false,
			};
		}
	}

	// Step 4: Check concurrent session limit
	const planLimits = org.planLimits ?? getPlanLimitsFromState(billingState, org.planId);
	const maxConcurrent = planLimits.maxConcurrentSessions;

	// For resume/connect operations, we don't count against the limit
	// (session is already running or paused)
	if (operation === "session_start" || operation === "automation_trigger") {
		if (sessionCounts.running >= maxConcurrent) {
			return {
				allowed: false,
				billingState,
				shadowBalance,
				message: `Concurrent session limit reached. Your plan allows ${maxConcurrent} concurrent session${maxConcurrent === 1 ? "" : "s"}.`,
				action: "block",
				errorCode: "CONCURRENT_LIMIT",
				terminal: false,
			};
		}
	}

	// Step 5: Check active coworker limit
	if (
		options.activeCoworkerCount !== undefined &&
		(operation === "session_start" || operation === "automation_trigger")
	) {
		const maxCoworkers =
			org.planLimits?.maxActiveCoworkers ?? getPlanCoworkerLimit(billingState, org.planId);
		if (options.activeCoworkerCount >= maxCoworkers) {
			return {
				allowed: false,
				billingState,
				shadowBalance,
				message: `Active coworker limit reached. Your plan allows ${maxCoworkers} active coworker${maxCoworkers === 1 ? "" : "s"}. Pause or remove a coworker to continue.`,
				action: "block",
				errorCode: "COWORKER_LIMIT",
				terminal: false,
			};
		}
	}

	// Step 6: Check monthly usage threshold
	if (
		options.monthlyUsage !== undefined &&
		(operation === "session_start" || operation === "automation_trigger")
	) {
		const creditsIncluded = planLimits.creditsIncluded;
		if (creditsIncluded > 0 && options.monthlyUsage >= creditsIncluded) {
			// Over monthly included credits — only block if overage policy is "pause"
			// (overage "allow" is handled by shadow balance + auto-top-up)
			if (!org.overagePolicy || org.overagePolicy === "pause") {
				return {
					allowed: false,
					billingState,
					shadowBalance,
					message: `Monthly usage limit reached (${Math.round(options.monthlyUsage)} / ${creditsIncluded} credits). Add credits or upgrade your plan.`,
					action: "block",
					errorCode: "MONTHLY_LIMIT",
					terminal: false,
				};
			}
		}
	}

	// All checks passed
	return {
		allowed: true,
		billingState,
		shadowBalance,
		message: getStateMessage(billingState, { graceExpiresAt, shadowBalance }),
	};
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get a human-readable description of an operation.
 */
function getOperationDescription(operation: GatedOperation): string {
	switch (operation) {
		case "session_start":
			return "start a session";
		case "session_resume":
			return "resume the session";
		case "automation_trigger":
			return "run this automation";
	}
}

/**
 * Get default plan limits based on billing state.
 */
function getPlanLimitsFromState(
	state: BillingState,
	planId?: BillingPlan | null,
): {
	maxConcurrentSessions: number;
	creditsIncluded: number;
} {
	switch (state) {
		case "active":
		case "trial": {
			if (planId && PLAN_CONFIGS[planId]) {
				return {
					maxConcurrentSessions: PLAN_CONFIGS[planId].maxConcurrentSessions,
					creditsIncluded: PLAN_CONFIGS[planId].creditsIncluded,
				};
			}
			return DEFAULT_PLAN_LIMITS;
		}
		default:
			return DEFAULT_PLAN_LIMITS;
	}
}

/**
 * Get default coworker limit based on billing state and plan.
 */
function getPlanCoworkerLimit(state: BillingState, planId?: BillingPlan | null): number {
	if ((state === "active" || state === "trial") && planId && PLAN_CONFIGS[planId]) {
		return PLAN_CONFIGS[planId].maxActiveCoworkers;
	}
	return 1; // Conservative default
}

/**
 * Quick check if org has any chance of starting a session.
 * Used for fast rejection without full gating check.
 */
export function canPossiblyStart(state: BillingState, graceExpiresAt: Date | null): boolean {
	if (state === "grace" && isGraceExpired(graceExpiresAt)) {
		return false;
	}
	return canStartSessionsInState(state);
}

/**
 * Check if a specific error code is recoverable by adding credits.
 */
export function isRecoverableByCredits(errorCode?: string): boolean {
	return errorCode === "NO_CREDITS" || errorCode === "GRACE_EXPIRED";
}

/**
 * Check if a specific error code is recoverable by stopping other sessions.
 */
export function isRecoverableByConcurrency(errorCode?: string): boolean {
	return errorCode === "CONCURRENT_LIMIT";
}
