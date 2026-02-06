/**
 * Types aligned to Autumn's actual API schema.
 * See: https://docs.useautumn.com/api-reference/
 */

// ============================================
// Customer Types
// ============================================

/**
 * GET /customers/:id response
 * See: https://docs.useautumn.com/api-reference/customers/get-customer
 */
export interface AutumnCustomer {
	id: string;
	name?: string;
	email?: string;
	features: Record<string, AutumnFeature>;
	products?: AutumnProduct[];
}

export interface AutumnProduct {
	id: string;
	name: string;
	status: "active" | "canceled" | "past_due";
	started_at?: number;
	canceled_at?: number | null;
	current_period_start?: number;
	current_period_end?: number;
}

export interface AutumnFeature {
	id: string;
	type: "boolean" | "metered" | "credit_system";
	interval?: "month" | "year" | "lifetime";
	interval_count?: number;
	unlimited?: boolean;
	balance?: number; // Current available
	usage?: number; // Used this period
	included_usage?: number; // Included in plan
	next_reset_at?: number; // Unix timestamp
}

// ============================================
// Check Endpoint Types
// ============================================

/**
 * POST /check request
 * See: https://docs.useautumn.com/documentation/customers/check
 */
export interface AutumnCheckRequest {
	customer_id: string;
	feature_id: string;
	/** Preferred by Autumn docs */
	required_balance?: number;
	/** Legacy field - will be mapped to required_balance */
	value?: number;
	send_event?: boolean;
	idempotency_key?: string;
	/** Optional customer data to auto-create customer */
	customer_data?: {
		name?: string;
		email?: string;
		fingerprint?: string;
	};
}

/**
 * POST /check response
 */
export interface AutumnCheckResponse {
	allowed: boolean;
	balance?: number;
	balances?: {
		feature_id: string;
		balance: number;
		required: number;
	}[];
}

// ============================================
// Track Endpoint Types
// ============================================

/**
 * POST /track request
 * See: https://docs.useautumn.com/api-reference/core/track
 */
export interface AutumnTrackRequest {
	customer_id: string;
	feature_id: string;
	value?: number;
	idempotency_key?: string;
	/** Optional customer data to auto-create customer */
	customer_data?: {
		name?: string;
		email?: string;
	};
}

/**
 * POST /track response
 * Note: Track does NOT return balance - only confirmation
 */
export interface AutumnTrackResponse {
	success: boolean;
	customer_id: string;
	feature_id: string;
}

// ============================================
// Attach Endpoint Types
// ============================================

/**
 * POST /attach request (create customer + product assignment)
 * See: https://docs.useautumn.com/api-reference/core/attach
 */
export interface AutumnAttachRequest {
	customer_id: string;
	product_id: string;
	product_ids?: string[];
	success_url?: string;
	cancel_url?: string;
	/** Force checkout even if payment method exists */
	force_checkout?: boolean;
	/** Optional feature quantities for credit packs */
	options?: Array<{
		feature_id: string;
		quantity: number;
	}>;
	/** If true, generate invoice immediately */
	invoice_immediately?: boolean;
	/** Idempotency key to prevent duplicate checkouts on retry */
	idempotency_key?: string;
	/** Optional customer data for creation */
	customer_data?: {
		name?: string;
		email?: string;
		fingerprint?: string;
	};
	/** Optional metadata forwarded to Stripe */
	metadata?: Record<string, string>;
	/** Optional checkout session params */
	checkout_session_params?: Record<string, unknown>;
}

/**
 * POST /attach response
 */
export interface AutumnAttachResponse {
	checkout_url?: string;
	url?: string;
	message?: string;
	success?: boolean;
	code?: string;
	customer?: AutumnCustomer;
}

// ============================================
// Setup Payment Types
// ============================================

export interface AutumnSetupPaymentRequest {
	customer_id: string;
	success_url?: string;
	cancel_url?: string;
	/** Optional checkout session params */
	checkout_session_params?: Record<string, unknown>;
	/** Optional customer data for creation */
	customer_data?: {
		name?: string;
		email?: string;
		fingerprint?: string;
	};
}

export interface AutumnSetupPaymentResponse {
	message?: string;
	url?: string;
	checkout_url?: string;
	client_secret?: string;
}

// ============================================
// Customer Create Types
// ============================================

export interface AutumnCreateCustomerRequest {
	id: string;
	name?: string | null;
	email?: string | null;
	fingerprint?: string | null;
	metadata?: Record<string, unknown> | null;
	stripe_id?: string | null;
}

export interface AutumnCreateCustomerResponse {
	id?: string | null;
	customer?: AutumnCustomer;
	data?: AutumnCustomer;
}

// ============================================
// Feature IDs used in Proliferate
// ============================================

/**
 * Autumn feature IDs configured in the Autumn dashboard.
 * These must match exactly what's configured in Autumn.
 */
export const AUTUMN_FEATURES = {
	/** Credit system - single pool for all usage */
	credits: "credits",

	/** Limit: max concurrent sessions */
	maxConcurrentSessions: "max_concurrent_sessions",

	/** Limit: max snapshots per org */
	maxSnapshots: "max_snapshots",
} as const;

/**
 * Autumn product IDs configured in the Autumn dashboard.
 *
 * For credit top-ups, use TOP_UP_PRODUCT instead (one-time purchase product).
 */
export const AUTUMN_PRODUCTS = {
	dev: "dev",
	pro: "pro",
} as const;

/**
 * Top-up product configuration.
 * This is the "tiptop" product in Autumn: $5 for 500 credits (one-time purchase).
 * Used by /api/billing/buy-credits endpoint.
 */
export const TOP_UP_PRODUCT = {
	productId: "tiptop",
	credits: 500,
	priceCents: 500, // $5.00
} as const;
