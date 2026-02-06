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
		overage_policy: "pause" | "allow";
		overage_cap_cents: number | null;
		overage_used_this_month_cents: number;
	};
	state: {
		billingState: "unconfigured" | "trial" | "active" | "grace" | "exhausted" | "suspended";
		shadowBalance: number;
		graceExpiresAt: string | null;
		canStartSession: boolean;
		stateMessage: string;
	};
}
