/**
 * Core billing types for the Proliferate billing system.
 *
 * Credit System: 1 credit = $1.00
 * - Compute: 1 credit per hour (~67% margin on E2B costs)
 * - LLM: 3x markup on LiteLLM's response_cost
 */

// ============================================
// Billing State (V2)
// ============================================

/**
 * Organization billing states.
 *
 * State transitions:
 * - free → exhausted (on free credits depleted, no grace)
 * - free → active (on plan attach)
 * - active → grace (on balance <= 0)
 * - grace → exhausted (on grace expiry)
 * - exhausted → active (on credits added)
 * - any → suspended (manual override)
 * - suspended → active (manual override)
 */
export type BillingState =
	| "free" // Free tier with permanent credits (no CC required)
	| "active" // Paid plan or purchased credits
	| "grace" // Balance exhausted, grace window active (paid plans only)
	| "exhausted" // Credits exhausted, sessions blocked
	| "suspended"; // Manually suspended (billing issues)

const VALID_BILLING_STATES = new Set<string>(["free", "active", "grace", "exhausted", "suspended"]);

/**
 * Normalize a raw billing state string from DB to a valid BillingState.
 * Maps legacy states (unconfigured, trial) to their V2 equivalents.
 */
export function normalizeBillingState(raw: string | null | undefined): BillingState {
	if (raw && VALID_BILLING_STATES.has(raw)) {
		return raw as BillingState;
	}
	// Legacy states: unconfigured → free, trial → free
	return "free";
}

/**
 * Grace window configuration.
 */
export const GRACE_WINDOW_CONFIG = {
	/** Default grace window duration in milliseconds (5 minutes) */
	defaultDurationMs: 5 * 60 * 1000,
	/** Maximum grace window duration in milliseconds (5 minutes) */
	maxDurationMs: 5 * 60 * 1000,
	/** Maximum overdraft allowed during grace (credits) */
	maxOverdraftCredits: 5,
} as const;

// ============================================
// Plan Configuration
// ============================================

export type BillingPlan = "dev" | "pro";

export interface PlanConfig {
	id: BillingPlan;
	name: string;
	monthlyPriceCents: number;
	creditsIncluded: number;
	maxConcurrentSessions: number;
	maxActiveCoworkers: number;
	maxSnapshots: number;
	snapshotRetentionDays: number;
}

export const PLAN_CONFIGS: Record<BillingPlan, PlanConfig> = {
	dev: {
		id: "dev",
		name: "Developer",
		monthlyPriceCents: 5000, // $50
		creditsIncluded: 100,
		maxConcurrentSessions: 10,
		maxActiveCoworkers: 3,
		maxSnapshots: 5,
		snapshotRetentionDays: 30,
	},
	pro: {
		id: "pro",
		name: "Professional",
		monthlyPriceCents: 20000, // $200
		creditsIncluded: 400,
		maxConcurrentSessions: 100,
		maxActiveCoworkers: 25,
		maxSnapshots: 200,
		snapshotRetentionDays: 90,
	},
};

// ============================================
// Free Tier Configuration
// ============================================

/** Credits granted to free tier orgs (no CC required, no expiry). */
export const FREE_CREDITS = 5;

// ============================================
// Billing Settings (stored in organization.billing_settings)
// ============================================

export interface OrgBillingSettings {
	auto_recharge_enabled: boolean;
	overage_cap_cents: number | null; // null = unlimited
}

export const DEFAULT_BILLING_SETTINGS: OrgBillingSettings = {
	auto_recharge_enabled: false,
	overage_cap_cents: null,
};

export function parseBillingSettings(raw: unknown): OrgBillingSettings {
	if (!raw) {
		return DEFAULT_BILLING_SETTINGS;
	}

	try {
		const value = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!value || typeof value !== "object") {
			return DEFAULT_BILLING_SETTINGS;
		}

		const candidate = value as Record<string, unknown>;

		// Handle migration from old overage_policy shape
		let autoRechargeEnabled: boolean;
		if (typeof candidate.auto_recharge_enabled === "boolean") {
			autoRechargeEnabled = candidate.auto_recharge_enabled;
		} else if (candidate.overage_policy === "allow") {
			// Backward compat: old "allow" policy maps to auto-recharge enabled
			autoRechargeEnabled = true;
		} else {
			autoRechargeEnabled = DEFAULT_BILLING_SETTINGS.auto_recharge_enabled;
		}

		const overageCap =
			typeof candidate.overage_cap_cents === "number" || candidate.overage_cap_cents === null
				? (candidate.overage_cap_cents as number | null)
				: DEFAULT_BILLING_SETTINGS.overage_cap_cents;

		return {
			auto_recharge_enabled: autoRechargeEnabled,
			overage_cap_cents: overageCap,
		};
	} catch {
		return DEFAULT_BILLING_SETTINGS;
	}
}

/**
 * Overage state from first-class DB columns (not JSONB).
 */
export interface OrgOverageState {
	overageUsedCents: number;
	overageCycleMonth: string | null;
	overageTopupCount: number;
	overageLastTopupAt: Date | null;
	overageDeclineAt: Date | null;
}

/**
 * Result of an overage auto-top-up attempt (service-level).
 * Distinct from the Autumn API-level AutoTopUpResult in autumn-client.ts.
 */
export interface OverageTopUpResult {
	success: boolean;
	packsCharged: number;
	creditsAdded: number;
	chargedCents: number;
	circuitBreakerTripped?: boolean;
	capExhausted?: boolean;
	velocityLimited?: boolean;
}

/** Maximum auto-top-ups per billing cycle (velocity limit). */
export const OVERAGE_MAX_TOPUPS_PER_CYCLE = 20;

/** Minimum interval between auto-top-ups for same org (rate limit, ms). */
export const OVERAGE_MIN_TOPUP_INTERVAL_MS = 60_000;

/** Get the current billing cycle month key (YYYY-MM in UTC). */
export function getCurrentCycleMonth(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function serializeBillingSettings(settings: OrgBillingSettings): string {
	return JSON.stringify(settings);
}

// Standard overage caps
export const OVERAGE_CAP_OPTIONS = [5000, 10000, 20000, 50000, null] as const; // in cents

// ============================================
// Credit Rates
// ============================================

/**
 * Compute credit rate.
 * E2B 4vCPU/8GiB costs ~$0.33/hr, we charge 1 credit/hr ($1) = ~67% margin
 */
export const COMPUTE_CREDITS_PER_HOUR = 1;
export const COMPUTE_CREDITS_PER_SECOND = COMPUTE_CREDITS_PER_HOUR / 3600;

/**
 * LLM markup multiplier applied to LiteLLM's response_cost.
 * We use LiteLLM's actual cost calculation, then apply 3x markup.
 */
export const LLM_MARKUP_MULTIPLIER = 3;

/**
 * Credit value in USD.
 */
export const CREDIT_VALUE_USD = 1.0;

/**
 * Calculate credits from LLM cost.
 * @param actualCostUsd - The actual USD cost from LiteLLM's response_cost
 * @returns Credits to charge (with 3x markup applied)
 */
export function calculateLLMCredits(actualCostUsd: number): number {
	return actualCostUsd * LLM_MARKUP_MULTIPLIER;
}

/**
 * Calculate credits from compute time.
 * @param seconds - Number of seconds of compute time
 * @returns Credits to charge
 */
export function calculateComputeCredits(seconds: number): number {
	return seconds * COMPUTE_CREDITS_PER_SECOND;
}

// ============================================
// Billing Event Types
// ============================================

export type BillingEventType = "compute" | "llm";

export type BillingEventStatus = "pending" | "posted" | "failed" | "skipped";

export interface BillingEvent {
	id: string;
	organization_id: string;
	event_type: BillingEventType;
	quantity: number;
	credits: number;
	idempotency_key: string;
	session_ids: string[];
	status: BillingEventStatus;
	retry_count: number;
	next_retry_at: string;
	last_error: string | null;
	autumn_response: unknown | null;
	metadata: BillingEventMetadata;
	created_at: string;
}

export interface BillingEventMetadata {
	// Compute events
	from_ms?: number;
	to_ms?: number;

	// LLM events
	model?: string;
	input_tokens?: number;
	output_tokens?: number;
	actual_cost_usd?: number;
}

// ============================================
// Session Billing Fields
// ============================================

export type PauseReason =
	| "manual"
	| "credit_limit"
	| "inactivity"
	| "overage_cap"
	| "payment_failed"
	| "suspended"
	| "orphaned"
	| "snapshot_failed";

export type StopReason = "manual" | "error" | "sandbox_terminated" | "auto_pause_failed";

export interface SessionBillingFields {
	metered_through_at: string | null;
	last_seen_alive_at: string | null;
	alive_check_failures: number;
	pause_reason: PauseReason | null;
	stop_reason: StopReason | null;
}

// ============================================
// Warning Thresholds
// ============================================

/** Budget warning level for nearing-limit notifications. */
export type BudgetWarningLevel = "none" | "approaching" | "critical" | "exhausted";

/** Configurable warning thresholds as percentage of plan credits. */
export const WARNING_THRESHOLDS = {
	/** First warning at 80% usage */
	approaching: 0.8,
	/** Critical warning at 95% usage */
	critical: 0.95,
	/** Hard limit at 100% */
	exhausted: 1.0,
} as const;

/**
 * Compute the warning level based on usage ratio.
 * @param used - Credits consumed this period
 * @param included - Credits included in plan
 * @returns Warning level
 */
export function computeWarningLevel(used: number, included: number): BudgetWarningLevel {
	if (included <= 0) return "none";
	const ratio = used / included;
	if (ratio >= WARNING_THRESHOLDS.exhausted) return "exhausted";
	if (ratio >= WARNING_THRESHOLDS.critical) return "critical";
	if (ratio >= WARNING_THRESHOLDS.approaching) return "approaching";
	return "none";
}

/** Usage summary for the current billing period. */
export interface UsageSummary {
	totalCredits: number;
	computeCredits: number;
	llmCredits: number;
	eventCount: number;
	periodStart: string;
	periodEnd: string;
}

/** Cost driver breakdown for billing insights. */
export interface CostDriver {
	label: string;
	entityId: string;
	entityType: "session" | "worker" | "repo";
	credits: number;
	eventCount: number;
	percentage: number;
}

/** Entitlement limit status for UI display. */
export interface EntitlementStatus {
	concurrentSessions: { current: number; max: number };
	activeCoworkers: { current: number; max: number };
}

// ============================================
// Gating Errors
// ============================================

export type BillingErrorCode =
	| "NO_CREDITS"
	| "CONCURRENT_LIMIT"
	| "COWORKER_LIMIT"
	| "BUDGET_EXHAUSTED"
	| "STATE_BLOCKED"
	| "GRACE_EXPIRED";

export interface BillingGateResult {
	allowed: boolean;
	error?: string;
	code?: BillingErrorCode;
	message?: string;
	action?: "block" | "pause_sessions";
}

export class BillingGateError extends Error {
	public readonly code: BillingErrorCode;

	constructor(message: string, code: BillingErrorCode) {
		super(message);
		this.name = "BillingGateError";
		this.code = code;
	}
}

// ============================================
// Metering Configuration
// ============================================

export const METERING_CONFIG = {
	/** How often the metering worker runs (ms) */
	pollIntervalMs: 30_000,

	/** Distributed lock TTL (ms) */
	lockTtlMs: 30_000,

	/** Lock renewal interval (ms) */
	lockRenewIntervalMs: 10_000,

	/** Minimum seconds to bill (skip tiny intervals) */
	minBillableSeconds: 10,

	/** Consecutive failures before declaring sandbox dead */
	graceFailures: 3,

	/** Max retry count for outbox events */
	maxRetries: 5,

	/** Base backoff for outbox retry (ms) */
	baseBackoffMs: 60_000,

	/** Max backoff for outbox retry (ms) */
	maxBackoffMs: 3_600_000,

	/** LLM sync batch size */
	llmSyncBatchSize: 500,

	/** LLM sync bootstrap lookback window (ms) */
	llmSyncBootstrapLookbackMs: 5 * 60 * 1000,

	/** LLM sync lookback window (ms) */
	llmSyncLookbackMs: 5 * 60 * 1000,

	/** Drift threshold (credits) that triggers a warning log during reconciliation */
	reconcileDriftWarnThreshold: 1,

	/** Drift threshold (credits) that triggers an error alert during reconciliation */
	reconcileDriftAlertThreshold: 5,

	/** Drift threshold (credits) that triggers a critical/paging alert */
	reconcileDriftCriticalThreshold: 10,

	/** Maximum staleness for reconciliation before alerting (ms) — 25 hours */
	reconcileMaxStalenessMs: 25 * 60 * 60 * 1000,

	/** Hot retention period for billing events (days) */
	billingEventsHotRetentionDays: 90,
} as const;

// ============================================
// Shadow Balance (V2)
// ============================================

/**
 * Shadow balance represents a locally-cached credit balance.
 * Updated atomically with billing event insertions.
 * Periodically reconciled with Autumn.
 */
export interface ShadowBalance {
	balance: number;
	updatedAt: Date;
}

// ============================================
// LLM Spend Cursor (V2)
// ============================================

/**
 * Cursor for tracking LLM spend log processing.
 * Enables cursor-based ingestion with deterministic ordering.
 */
export interface LLMSpendCursor {
	/** Last processed timestamp */
	lastStartTime: Date;
	/** Last processed request ID (for tie-breaking) */
	lastRequestId: string | null;
	/** Number of records processed */
	recordsProcessed: number;
	/** Last sync timestamp */
	syncedAt: Date;
}

// ============================================
// Billing Reconciliation (V2)
// ============================================

/**
 * Types of reconciliation events.
 */
export type ReconciliationType =
	| "shadow_sync" // Regular shadow balance sync with Autumn
	| "manual_adjustment" // Manual credit adjustment
	| "refund" // Credit refund
	| "correction" // Error correction
	| "auto_topup" // Auto-top-up credit addition
	| "fast_reconcile"; // Event-driven fast reconcile

/**
 * Reconciliation record for audit trail.
 */
export interface BillingReconciliation {
	id: string;
	organizationId: string;
	type: ReconciliationType;
	previousBalance: number;
	newBalance: number;
	delta: number;
	reason: string;
	performedBy: string | null; // null for automated reconciliation
	metadata: Record<string, unknown>;
	createdAt: Date;
}

// ============================================
// Gating Result (V2)
// ============================================

/**
 * Result of billing gate check.
 */
export interface GatingResult {
	allowed: boolean;
	billingState: BillingState;
	shadowBalance: number;
	message?: string;
	/** Action to take if not allowed */
	action?: "block" | "pause_sessions";
}

/**
 * Operations that require billing gate check.
 */
export type GatedOperation = "session_start" | "session_resume" | "automation_trigger";
