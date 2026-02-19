/**
 * Core billing types for the Proliferate billing system.
 *
 * Credit System: 1 credit = $0.01 (1 cent)
 * - Compute: 1 credit per minute (~4.5x margin on E2B costs)
 * - LLM: Credits calculated from LiteLLM's response_cost × 3x markup
 */

// ============================================
// Billing State (V2)
// ============================================

/**
 * Organization billing states.
 *
 * State transitions:
 * - unconfigured → active (on plan attach)
 * - trial → exhausted (on trial credits depleted)
 * - active → grace (on balance <= 0)
 * - grace → exhausted (on grace expiry)
 * - exhausted → active (on top-up)
 * - any → suspended (manual override)
 * - suspended → active (manual override)
 */
export type BillingState =
	| "unconfigured" // No billing set up yet
	| "trial" // Credit-based trial (plan selected, not yet billed)
	| "active" // Paid plan with positive balance
	| "grace" // Balance exhausted, grace window active
	| "exhausted" // Credits exhausted, sessions blocked
	| "suspended"; // Manually suspended (billing issues)

/**
 * Grace window configuration.
 */
export const GRACE_WINDOW_CONFIG = {
	/** Default grace window duration in milliseconds (5 minutes) */
	defaultDurationMs: 5 * 60 * 1000,
	/** Maximum grace window duration in milliseconds (1 hour) */
	maxDurationMs: 60 * 60 * 1000,
	/** Maximum overdraft allowed during grace (credits) */
	maxOverdraftCredits: 500,
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
	maxSnapshots: number;
	snapshotRetentionDays: number;
}

export const PLAN_CONFIGS: Record<BillingPlan, PlanConfig> = {
	dev: {
		id: "dev",
		name: "Developer",
		monthlyPriceCents: 2000, // $20
		creditsIncluded: 1000,
		maxConcurrentSessions: 10,
		maxSnapshots: 5,
		snapshotRetentionDays: 30,
	},
	pro: {
		id: "pro",
		name: "Professional",
		monthlyPriceCents: 50000, // $500
		creditsIncluded: 7500,
		maxConcurrentSessions: 100,
		maxSnapshots: 200,
		snapshotRetentionDays: 90,
	},
};

// ============================================
// Trial Configuration
// ============================================

/** Credit-based trial amount granted on signup. */
export const TRIAL_CREDITS = 1000;

// ============================================
// Billing Settings (stored in organization.billing_settings)
// ============================================

export type OveragePolicy = "pause" | "allow";

export interface OrgBillingSettings {
	overage_policy: OveragePolicy;
	overage_cap_cents: number | null; // null = unlimited (if policy is 'allow')
	overage_used_this_month_cents: number;
}

export const DEFAULT_BILLING_SETTINGS: OrgBillingSettings = {
	overage_policy: "pause",
	overage_cap_cents: null,
	overage_used_this_month_cents: 0,
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

		const candidate = value as Partial<OrgBillingSettings>;
		const overagePolicy =
			candidate.overage_policy === "pause" || candidate.overage_policy === "allow"
				? candidate.overage_policy
				: DEFAULT_BILLING_SETTINGS.overage_policy;
		const overageCap =
			typeof candidate.overage_cap_cents === "number" || candidate.overage_cap_cents === null
				? candidate.overage_cap_cents
				: DEFAULT_BILLING_SETTINGS.overage_cap_cents;
		const overageUsed =
			typeof candidate.overage_used_this_month_cents === "number"
				? candidate.overage_used_this_month_cents
				: DEFAULT_BILLING_SETTINGS.overage_used_this_month_cents;

		return {
			overage_policy: overagePolicy,
			overage_cap_cents: overageCap,
			overage_used_this_month_cents: overageUsed,
		};
	} catch {
		return DEFAULT_BILLING_SETTINGS;
	}
}

export function serializeBillingSettings(settings: OrgBillingSettings): string {
	return JSON.stringify(settings);
}

// Standard overage caps
export const OVERAGE_CAP_OPTIONS = [5000, 10000, 20000, 50000, null] as const; // in cents
export const OVERAGE_INCREMENT_CENTS = 5000; // $50 per auto-charge
export const OVERAGE_INCREMENT_CREDITS = 5000; // 5000 credits per $50

// ============================================
// Credit Rates
// ============================================

/**
 * Compute credit rate.
 * E2B costs ~$0.00222/min, we charge 1 credit/min ($0.01) = 4.5x margin
 */
export const COMPUTE_CREDITS_PER_MINUTE = 1;
export const COMPUTE_CREDITS_PER_SECOND = COMPUTE_CREDITS_PER_MINUTE / 60;

/**
 * LLM markup multiplier applied to LiteLLM's response_cost.
 * We use LiteLLM's actual cost calculation, then apply 3x markup.
 */
export const LLM_MARKUP_MULTIPLIER = 3;

/**
 * Whitelist of models allowed for LLM billing.
 * Models not in this list will be REJECTED (fail closed).
 * This prevents "free" usage if LiteLLM returns 0 cost for unknown models.
 *
 * Update this list when adding new models to the proxy.
 */
export const ALLOWED_LLM_MODELS = new Set([
	// Anthropic Claude
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
	"claude-3-7-sonnet-20250219",
	"claude-3-opus-20240229",
	"claude-3-sonnet-20240229",
	"claude-3-haiku-20240307",
	"claude-sonnet-4-20250514",
	"claude-sonnet-4-5-20250929",
	"claude-opus-4-20250514",
	"claude-opus-4-5-20251101",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	// OpenAI GPT-4
	"gpt-4-turbo",
	"gpt-4-turbo-preview",
	"gpt-4-0125-preview",
	"gpt-4-1106-preview",
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4o-2024-08-06",
	// OpenAI GPT-3.5
	"gpt-3.5-turbo",
	"gpt-3.5-turbo-0125",
	// OpenAI o1/o3
	"o1-preview",
	"o1-mini",
	"o3-mini",
	// OpenAI GPT-5
	"gpt-5",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.2",
	"gpt-5.2-pro",
	// Google Gemini
	"gemini-1.5-pro",
	"gemini-1.5-flash",
	"gemini-2.0-flash-exp",
	"gemini-3-pro-preview",
	"gemini-3-flash-preview",
	// DeepSeek
	"deepseek-chat",
	"deepseek-coder",
]);

/**
 * Check if a model is allowed for billing.
 * Models not in the whitelist are rejected to prevent free usage.
 */
export function isModelAllowedForBilling(model: string): boolean {
	// Normalize model name (remove provider prefixes like "anthropic/")
	const normalizedModel = model.includes("/") ? model.split("/").pop()! : model;
	return ALLOWED_LLM_MODELS.has(normalizedModel);
}

/**
 * Minimum cost threshold for LLM billing.
 * If response_cost is below this, we reject the request (fail closed).
 * This prevents exploitation via cached responses or cost calculation bugs.
 */
export const MIN_LLM_COST_USD = 0.000001; // $0.000001 minimum

/**
 * Credit value in USD.
 */
export const CREDIT_VALUE_USD = 0.01;

/**
 * Calculate credits from LLM cost.
 * @param actualCostUsd - The actual USD cost from LiteLLM's response_cost
 * @returns Credits to charge (with 3x markup applied)
 */
export function calculateLLMCredits(actualCostUsd: number): number {
	const costWithMarkup = actualCostUsd * LLM_MARKUP_MULTIPLIER;
	return costWithMarkup / CREDIT_VALUE_USD;
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

export type BillingEventStatus = "pending" | "posted" | "failed";

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
	billing_token_version: number;
	last_seen_alive_at: string | null;
	alive_check_failures: number;
	pause_reason: PauseReason | null;
	stop_reason: StopReason | null;
}

// ============================================
// Gating Errors
// ============================================

export type BillingErrorCode =
	| "NO_CREDITS"
	| "CONCURRENT_LIMIT"
	| "BILLING_NOT_CONFIGURED"
	| "STATE_BLOCKED"
	| "GRACE_EXPIRED";

export interface BillingGateResult {
	allowed: boolean;
	error?: string;
	code?: BillingErrorCode;
	message?: string;
	action?: "block" | "terminate_sessions";
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

	/** Absolute drift threshold (credits) that triggers an alert during reconciliation */
	reconcileDriftAlertThreshold: 500,
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
	| "correction"; // Error correction

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
	action?: "block" | "terminate_sessions";
}

/**
 * Operations that require billing gate check.
 */
export type GatedOperation =
	| "session_start"
	| "session_resume"
	| "cli_connect"
	| "automation_trigger";
