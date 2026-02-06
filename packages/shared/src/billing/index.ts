/**
 * Billing module exports.
 *
 * @module @proliferate/shared/billing
 */

// Types
export * from "./types";
export * from "./autumn-types";

// State machine (V2)
export * from "./state";

// Unified gating (V2)
export * from "./gating";

// Autumn API client
export {
	autumnGetCustomer,
	autumnAttach,
	autumnCreateCustomer,
	autumnSetupPayment,
	autumnCheck,
	autumnTrack,
	autumnCheckCredits,
	autumnDeductCredits,
	autumnGetBalance,
	autumnGetLimit,
	autumnAutoTopUp,
	type AutoTopUpResult,
} from "./autumn-client";

// Billing token system
export {
	mintBillingToken,
	verifyBillingToken,
	validateBillingToken,
	extractBillingToken,
	type BillingTokenClaims,
	type SessionForBillingValidation,
} from "./billing-token";

// Distributed locking
export {
	acquireLock,
	renewLock,
	releaseLock,
	withLock,
	BILLING_REDIS_KEYS,
} from "./distributed-lock";

// Database-backed billing workflows now live in @proliferate/services/billing.
