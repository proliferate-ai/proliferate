/**
 * Types for billing data returned from the API.
 */

export interface BillingInfo {
	plan: {
		id: string;
		name: string;
		monthlyPriceCents: number;
		creditsIncluded: number;
	};
	selectedPlan: "dev" | "pro";
	hasActiveSubscription: boolean;
	hasPaymentMethod: boolean;
	credits: {
		balance: number;
		used: number;
		included: number;
		nextResetAt: string | null;
	};
	limits: {
		maxConcurrentSessions: number;
		maxSnapshots: number;
		snapshotRetentionDays: number;
	};
	billingSettings: {
		auto_recharge_enabled: boolean;
		overage_cap_cents: number | null;
	};
	state: {
		billingState: "free" | "active" | "grace" | "exhausted" | "suspended";
		shadowBalance: number;
		graceExpiresAt: string | null;
		canStartSession: boolean;
		stateMessage: string;
	};
}
