/**
 * Autumn API client for billing operations.
 *
 * Autumn is an open-source billing system that sits on top of Stripe.
 * It handles subscriptions, metered usage, and credit systems.
 *
 * @see https://docs.useautumn.com/api-reference/
 */

import { env } from "@proliferate/environment/server";
import { getSharedLogger } from "../logger";
import type {
	AutumnAttachRequest,
	AutumnAttachResponse,
	AutumnCheckRequest,
	AutumnCheckResponse,
	AutumnCreateCustomerRequest,
	AutumnCreateCustomerResponse,
	AutumnCustomer,
	AutumnSetupPaymentRequest,
	AutumnSetupPaymentResponse,
	AutumnTrackRequest,
	AutumnTrackResponse,
} from "./autumn-types";

// ============================================
// Configuration
// ============================================

function getAutumnConfig() {
	let baseUrl = cleanEnvValue(env.AUTUMN_API_URL);
	const apiKey = cleanEnvValue(env.AUTUMN_API_KEY);

	// Allow either `https://api.useautumn.com` or `https://api.useautumn.com/v1`.
	baseUrl = baseUrl.replace(/\/+$/, "");
	if (baseUrl.endsWith("/v1")) {
		baseUrl = baseUrl.slice(0, -3);
	}

	if (!baseUrl || !apiKey) {
		throw new Error("Missing Autumn configuration: AUTUMN_API_URL and AUTUMN_API_KEY are required");
	}

	return { baseUrl, apiKey };
}

function cleanEnvValue(value: string | undefined): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) {
		return "";
	}
	// Protect against accidentally including inline comments in secrets, e.g.
	// `AUTUMN_API_KEY=am_sk_... # Sandbox`
	return trimmed.replace(/\s+#.*$/, "").trim();
}

function buildAutumnAuthorizationHeader(apiKey: string): string {
	const token = apiKey.replace(/^Bearer\s+/i, "").trim();
	return `Bearer ${token}`;
}

// ============================================
// HTTP Client
// ============================================

async function autumnRequest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
	const { baseUrl, apiKey } = getAutumnConfig();

	// Autumn API v1 - ensure path has /v1 prefix
	const fullPath = path.startsWith("/v1") ? path : `/v1${path}`;

	const response = await fetch(`${baseUrl}${fullPath}`, {
		method,
		headers: {
			Authorization: buildAutumnAuthorizationHeader(apiKey),
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Autumn API error (${response.status}): ${errorText}`);
	}

	return response.json() as Promise<T>;
}

// ============================================
// Customer Operations
// ============================================

/**
 * Get customer details including feature balances.
 */
export async function autumnGetCustomer(customerId: string): Promise<AutumnCustomer> {
	return autumnRequest<AutumnCustomer>("GET", `/customers/${encodeURIComponent(customerId)}`);
}

/**
 * Attach a product to a customer (creates customer if needed).
 * Returns a checkout URL for payment collection.
 */
export async function autumnAttach(request: AutumnAttachRequest): Promise<AutumnAttachResponse> {
	return autumnRequest<AutumnAttachResponse>("POST", "/attach", request);
}

/**
 * Create or fetch a customer.
 */
export async function autumnCreateCustomer(
	request: AutumnCreateCustomerRequest,
): Promise<AutumnCreateCustomerResponse> {
	return autumnRequest<AutumnCreateCustomerResponse>("POST", "/customers", request);
}

/**
 * Initiate payment method setup (no immediate charge).
 */
export async function autumnSetupPayment(
	request: AutumnSetupPaymentRequest,
): Promise<AutumnSetupPaymentResponse> {
	try {
		return await autumnRequest<AutumnSetupPaymentResponse>("POST", "/payment/setup", request);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("404")) {
			return await autumnRequest<AutumnSetupPaymentResponse>("POST", "/setup_payment", request);
		}
		throw err;
	}
}

// ============================================
// Usage Operations
// ============================================

/**
 * Check if customer can use a feature.
 * Optionally records usage atomically with the check.
 *
 * @param request.customer_id - Organization ID
 * @param request.feature_id - Feature to check (e.g., 'compute', 'llm')
 * @param request.required_balance - Amount to check/deduct (default: 1)
 * @param request.send_event - If true, atomically record usage on success
 * @param request.idempotency_key - Prevent duplicate charges
 */
export async function autumnCheck(request: AutumnCheckRequest): Promise<AutumnCheckResponse> {
	const required_balance =
		request.required_balance !== undefined ? request.required_balance : request.value;
	return autumnRequest<AutumnCheckResponse>("POST", "/check", {
		...request,
		required_balance,
		// Remove legacy field to avoid API rejection
		value: undefined,
	});
}

/**
 * Track usage for a feature (fire-and-forget).
 * Unlike check, this doesn't verify balance first.
 * Use check with send_event:true for atomic check+track.
 */
export async function autumnTrack(request: AutumnTrackRequest): Promise<AutumnTrackResponse> {
	return autumnRequest<AutumnTrackResponse>("POST", "/track", request);
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Check if customer has enough credits for an operation.
 * Does NOT deduct credits - just checks availability.
 */
export async function autumnCheckCredits(
	customerId: string,
	featureId: string,
	amount: number,
): Promise<{ allowed: boolean; balance?: number }> {
	const result = await autumnCheck({
		customer_id: customerId,
		feature_id: featureId,
		required_balance: amount,
		send_event: false,
	});

	const featureBalance = result.balances?.find((b) => b.feature_id === featureId);
	return {
		allowed: result.allowed,
		balance: featureBalance?.balance ?? result.balance,
	};
}

/**
 * Deduct credits from customer, checking balance first.
 * Atomic operation using check with send_event:true.
 */
export async function autumnDeductCredits(
	customerId: string,
	featureId: string,
	amount: number,
	idempotencyKey: string,
): Promise<AutumnCheckResponse> {
	return autumnCheck({
		customer_id: customerId,
		feature_id: featureId,
		required_balance: amount,
		send_event: true,
		idempotency_key: idempotencyKey,
	});
}

/**
 * Get customer's current credit balance for a feature.
 */
export async function autumnGetBalance(
	customerId: string,
	featureId: string,
): Promise<{ balance: number; usage: number; included: number }> {
	const customer = await autumnGetCustomer(customerId);
	const feature = customer.features[featureId];

	if (!feature) {
		throw new Error(`Feature '${featureId}' not found for customer`);
	}

	return {
		balance: feature.balance ?? 0,
		usage: feature.usage ?? 0,
		included: feature.included_usage ?? 0,
	};
}

/**
 * Get customer's feature limit (for non-credit features like max_concurrent_sessions).
 */
export async function autumnGetLimit(customerId: string, featureId: string): Promise<number> {
	const customer = await autumnGetCustomer(customerId);
	const feature = customer.features[featureId];

	if (!feature) {
		throw new Error(`Feature '${featureId}' not found for customer`);
	}

	if (feature.unlimited) {
		return Number.POSITIVE_INFINITY;
	}

	return feature.balance ?? 0;
}

// ============================================
// Auto Top-Up Operations
// ============================================

export interface AutoTopUpResult {
	success: boolean;
	/** If true, checkout URL was returned - user has no payment method on file */
	requiresCheckout: boolean;
	checkoutUrl?: string;
	creditsAdded?: number;
}

/**
 * Automatically purchase credits for a customer.
 * Only works if customer has a payment method on file with Stripe.
 *
 * @param customerId - Organization ID
 * @param productId - The top-up product ID (e.g., "top_up")
 * @param credits - Number of credits in the top-up (for logging)
 * @returns success=true if charged, success=false if requires checkout or failed
 */
export async function autumnAutoTopUp(
	customerId: string,
	productId: string,
	credits: number,
): Promise<AutoTopUpResult> {
	try {
		const result = await autumnAttach({
			customer_id: customerId,
			product_id: productId,
			invoice_immediately: true,
		});

		const checkoutUrl = result.checkout_url ?? result.url;
		// If checkout URL is returned, customer has no payment method on file
		if (checkoutUrl) {
			getSharedLogger().info({ customerId, module: "autumn" }, "Auto top-up requires checkout");
			return {
				success: false,
				requiresCheckout: true,
				checkoutUrl,
			};
		}

		// No checkout URL = charged successfully
		getSharedLogger().info({ customerId, credits, module: "autumn" }, "Auto top-up successful");
		return {
			success: true,
			requiresCheckout: false,
			creditsAdded: credits,
		};
	} catch (err) {
		getSharedLogger().error({ err, customerId, module: "autumn" }, "Auto top-up failed");
		return {
			success: false,
			requiresCheckout: false,
		};
	}
}
