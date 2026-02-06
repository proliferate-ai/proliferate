/**
 * Billing State Machine (V2)
 *
 * Manages organization billing state transitions and enforcement actions.
 *
 * States:
 * - unconfigured: No billing set up
 * - trial: Using trial credits (plan selected, not yet billed)
 * - active: Paid plan with positive balance
 * - grace: Balance exhausted, grace window active
 * - exhausted: Grace expired, sessions blocked
 * - suspended: Manually suspended (billing issues)
 */

import {
	type BillingState,
	GRACE_WINDOW_CONFIG,
	type GatedOperation,
	type GatingResult,
} from "./types";

// ============================================
// State Transition Types
// ============================================

/**
 * Events that can trigger state transitions.
 */
export type BillingStateEvent =
	| { type: "plan_attached"; plan: string }
	| { type: "trial_started" }
	| { type: "balance_depleted" }
	| { type: "grace_expired" }
	| { type: "credits_added"; amount: number }
	| { type: "manual_suspend"; reason: string }
	| { type: "manual_unsuspend" };

/**
 * Enforcement action to take after a state transition.
 */
export type EnforcementAction =
	| { type: "none" }
	| { type: "terminate_sessions"; reason: string }
	| { type: "block_new_sessions"; reason: string };

/**
 * Result of a state transition.
 */
export interface StateTransitionResult {
	previousState: BillingState;
	newState: BillingState;
	transitioned: boolean;
	action: EnforcementAction;
	graceExpiresAt?: Date;
}

// ============================================
// State Transition Logic
// ============================================

/**
 * Valid state transitions map.
 * Key: current state
 * Value: map of event type to new state
 */
const VALID_TRANSITIONS: Record<
	BillingState,
	Partial<Record<BillingStateEvent["type"], BillingState>>
> = {
	unconfigured: {
		plan_attached: "active",
		trial_started: "trial",
	},
	trial: {
		plan_attached: "active",
		balance_depleted: "exhausted",
		manual_suspend: "suspended",
	},
	active: {
		balance_depleted: "grace",
		manual_suspend: "suspended",
	},
	grace: {
		grace_expired: "exhausted",
		credits_added: "active",
		manual_suspend: "suspended",
	},
	exhausted: {
		credits_added: "active",
		manual_suspend: "suspended",
	},
	suspended: {
		manual_unsuspend: "active",
	},
};

/**
 * Calculate the next state given current state and event.
 */
export function getNextState(currentState: BillingState, event: BillingStateEvent): BillingState {
	const transitions = VALID_TRANSITIONS[currentState];
	const nextState = transitions[event.type];

	if (!nextState) {
		// Invalid transition - stay in current state
		return currentState;
	}

	return nextState;
}

/**
 * Process a billing event and return the transition result.
 */
export function processStateTransition(
	currentState: BillingState,
	event: BillingStateEvent,
	options?: {
		graceWindowDurationMs?: number;
	},
): StateTransitionResult {
	const nextState = getNextState(currentState, event);
	const transitioned = nextState !== currentState;

	let action: EnforcementAction = { type: "none" };
	let graceExpiresAt: Date | undefined;

	if (transitioned) {
		// Determine enforcement action based on new state
		switch (nextState) {
			case "grace": {
				// Entering grace period - set expiry and warn
				const requestedDuration =
					options?.graceWindowDurationMs ?? GRACE_WINDOW_CONFIG.defaultDurationMs;
				const graceDuration = Math.max(
					0,
					Math.min(requestedDuration, GRACE_WINDOW_CONFIG.maxDurationMs),
				);
				graceExpiresAt = new Date(Date.now() + graceDuration);
				action = {
					type: "block_new_sessions",
					reason: `Credits exhausted. Grace period active until ${graceExpiresAt.toISOString()}`,
				};
				break;
			}

			case "exhausted":
				// Grace expired - terminate all sessions
				action = {
					type: "terminate_sessions",
					reason: "Grace period expired. All sessions terminated.",
				};
				break;

			case "suspended":
				// Manually suspended - terminate all sessions
				action = {
					type: "terminate_sessions",
					reason:
						event.type === "manual_suspend"
							? (event as { type: "manual_suspend"; reason: string }).reason
							: "Account suspended",
				};
				break;

			case "active":
				// Returning to active state - no action needed
				action = { type: "none" };
				break;
		}
	}

	return {
		previousState: currentState,
		newState: nextState,
		transitioned,
		action,
		graceExpiresAt,
	};
}

// ============================================
// State Checks
// ============================================

/**
 * Check if sessions can be started in the given billing state.
 */
export function canStartSessionsInState(state: BillingState): boolean {
	switch (state) {
		case "trial":
		case "active":
			return true;
		case "grace":
		case "exhausted":
		case "suspended":
		case "unconfigured":
			return false;
	}
}

/**
 * Check if existing sessions should be terminated in the given billing state.
 */
export function shouldTerminateSessionsInState(state: BillingState): boolean {
	switch (state) {
		case "exhausted":
		case "suspended":
			return true;
		case "unconfigured":
		case "trial":
		case "active":
		case "grace":
			return false;
	}
}

/**
 * Check if the grace period has expired.
 */
export function isGraceExpired(graceExpiresAt: Date | null): boolean {
	// Null is treated as expired for fail-closed behavior in grace state.
	if (!graceExpiresAt) return true;
	return Date.now() > graceExpiresAt.getTime();
}

/**
 * Get a human-readable message for the billing state.
 */
export function getStateMessage(
	state: BillingState,
	options?: {
		graceExpiresAt?: Date | null;
		shadowBalance?: number;
	},
): string {
	switch (state) {
		case "unconfigured":
			return "Billing not configured. Set up a plan to start sessions.";
		case "trial":
			return "Using trial credits.";
		case "active":
			return options?.shadowBalance !== undefined
				? `Active with ${options.shadowBalance.toFixed(2)} credits remaining.`
				: "Active billing.";
		case "grace":
			if (options?.graceExpiresAt) {
				const remaining = Math.max(0, options.graceExpiresAt.getTime() - Date.now());
				const minutes = Math.ceil(remaining / 60000);
				return `Credits exhausted. Grace period expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
			}
			return "Credits exhausted. Grace period active.";
		case "exhausted":
			return "Credits exhausted. Activate your plan or add credits to continue.";
		case "suspended":
			return "Account suspended. Contact support.";
	}
}

// ============================================
// Gating
// ============================================

/**
 * Check if an operation is allowed given the billing state and shadow balance.
 * This is the unified gating function for all session operations.
 */
export function checkGate(
	state: BillingState,
	shadowBalance: number,
	_operation: GatedOperation,
	options?: {
		graceExpiresAt?: Date | null;
	},
): GatingResult {
	// Check if grace period has expired and we should transition to exhausted
	if (state === "grace" && isGraceExpired(options?.graceExpiresAt ?? null)) {
		return {
			allowed: false,
			billingState: "exhausted",
			shadowBalance,
			message: "Grace period expired. Add credits to continue.",
			action: "terminate_sessions",
		};
	}

	// Check if sessions can be started
	const canStart = canStartSessionsInState(state);

	if (!canStart) {
		const shouldTerminate = shouldTerminateSessionsInState(state);
		return {
			allowed: false,
			billingState: state,
			shadowBalance,
			message: getStateMessage(state, { graceExpiresAt: options?.graceExpiresAt, shadowBalance }),
			action: shouldTerminate ? "terminate_sessions" : "block",
		};
	}

	// For active states, check if there are sufficient credits
	// (handled separately by shadow balance logic)

	return {
		allowed: true,
		billingState: state,
		shadowBalance,
		message: getStateMessage(state, { graceExpiresAt: options?.graceExpiresAt, shadowBalance }),
	};
}

// ============================================
// State Persistence Helpers
// ============================================

/**
 * Fields to update when transitioning to a new state.
 */
export interface StateUpdateFields {
	billingState: BillingState;
	graceEnteredAt?: Date | null;
	graceExpiresAt?: Date | null;
}

/**
 * Get the database update fields for a state transition.
 */
export function getStateUpdateFields(result: StateTransitionResult): StateUpdateFields {
	const fields: StateUpdateFields = {
		billingState: result.newState,
	};

	if (result.newState === "grace") {
		fields.graceEnteredAt = new Date();
		fields.graceExpiresAt = result.graceExpiresAt ?? null;
	} else if (result.previousState === "grace") {
		// Leaving grace state - clear grace fields
		fields.graceEnteredAt = null;
		fields.graceExpiresAt = null;
	}

	return fields;
}
