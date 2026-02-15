/**
 * Billing Worker
 *
 * Runs periodic billing tasks:
 * - Compute metering (every 30 seconds)
 * - LLM spend sync (every 30 seconds)
 * - Outbox processing (every 60 seconds)
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { getRedisClient } from "@proliferate/queue";
import { billing, orgs } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

// ============================================
// Billing Job State
// ============================================

let meteringInterval: NodeJS.Timeout | null = null;
let llmSyncInterval: NodeJS.Timeout | null = null;
let outboxInterval: NodeJS.Timeout | null = null;
let graceInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let _logger: Logger;

// ============================================
// Billing Functions
// ============================================

/**
 * Run the compute metering cycle.
 * Bills all running sessions for their elapsed compute time.
 */
async function runMeteringCycle(): Promise<void> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return;
	}

	try {
		const redis = getRedisClient();
		const providers = await getProvidersMap();

		await billing.runMeteringCycle(redis, providers);
	} catch (error) {
		_logger.error({ err: error }, "Metering cycle error");
	}
}

/**
 * Process the billing outbox.
 * Retries failed Autumn API calls.
 */
async function processOutbox(): Promise<void> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return;
	}

	try {
		const redis = getRedisClient();
		const providers = await getProvidersMap();

		await billing.processOutbox(redis, providers);
	} catch (error) {
		_logger.error({ err: error }, "Outbox processing error");
	}
}

/**
 * Sync LLM spend to billing_events.
 * Pending migration to per-org REST API client (litellm-api.ts) + bulkDeductShadowBalance.
 */
async function syncLLMSpend(): Promise<void> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return;
	}

	// TODO: Rewrite to use per-org REST API client (billing.fetchSpendLogs)
	// and per-org cursors (billing.getLLMSpendCursor/updateLLMSpendCursor).
	// The old cross-schema SQL queries have been removed in favour of litellm-api.ts.
	_logger.child({ op: "llm-sync" }).warn("LLM spend sync disabled — pending REST API migration");
}

/**
 * Check for expired grace periods and enforce exhausted state.
 */
async function checkGraceExpirations(): Promise<void> {
	if (!env.AUTUMN_API_URL || !env.AUTUMN_API_KEY) {
		return;
	}

	const graceLog = _logger.child({ op: "grace" });

	try {
		const expiredOrgs = await orgs.listGraceExpiredOrgs();
		if (!expiredOrgs.length) return;

		const providers = await getProvidersMap();
		for (const org of expiredOrgs) {
			try {
				await orgs.expireGraceForOrg(org.id);
				await billing.handleCreditsExhaustedV2(org.id, providers);
				graceLog.info({ orgId: org.id }, "Grace expired -> exhausted");
			} catch (err) {
				graceLog.error({ err, orgId: org.id }, "Failed to expire grace for org");
			}
		}
	} catch (err) {
		graceLog.error({ err }, "Error checking grace expirations");
	}
}

/**
 * Build a providers map for sandbox operations.
 */
async function getProvidersMap(): Promise<Map<string, SandboxProvider>> {
	const providers = new Map<string, SandboxProvider>();

	// Only add E2B provider if configured
	if (env.E2B_API_KEY) {
		try {
			const e2bProvider = getSandboxProvider("e2b");
			providers.set("e2b", e2bProvider);
		} catch {
			// E2B not available
		}
	}

	// Only add Modal provider if configured
	if (env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET) {
		try {
			const modalProvider = getSandboxProvider("modal");
			providers.set("modal", modalProvider);
		} catch {
			// Modal not available
		}
	}

	return providers;
}

// ============================================
// Worker Lifecycle
// ============================================

/**
 * Start the billing worker.
 * Runs metering every 30s, LLM sync every 30s, and outbox every 60s.
 */
export function startBillingWorker(logger: Logger): void {
	_logger = logger;

	if (isRunning) {
		_logger.warn("Already running");
		return;
	}

	_logger.info("Starting billing worker");

	// Run metering every 30 seconds
	meteringInterval = setInterval(async () => {
		await runMeteringCycle();
	}, 30_000);

	// Run LLM spend sync every 30 seconds
	llmSyncInterval = setInterval(async () => {
		await syncLLMSpend();
	}, 30_000);

	// Run outbox every 60 seconds - start immediately (no delay)
	// Concurrent runs with metering are safe because:
	// - Metering uses idempotency keys to prevent double-billing
	// - Outbox uses status=pending filter and atomic updates
	outboxInterval = setInterval(async () => {
		await processOutbox();
	}, 60_000);

	// Run grace expiration checks every 60 seconds
	graceInterval = setInterval(async () => {
		await checkGraceExpirations();
	}, 60_000);

	isRunning = true;

	_logger.info(
		{ meteringIntervalSec: 30, llmSyncIntervalSec: 30, outboxIntervalSec: 60 },
		"Billing worker started",
	);

	// Run initial cycles after a short delay
	setTimeout(runMeteringCycle, 5_000);
	setTimeout(syncLLMSpend, 3_000);
}

/**
 * Stop the billing worker.
 */
export function stopBillingWorker(): void {
	if (!isRunning) {
		return;
	}

	_logger.info("Stopping billing worker");

	if (meteringInterval) {
		clearInterval(meteringInterval);
		meteringInterval = null;
	}

	if (llmSyncInterval) {
		clearInterval(llmSyncInterval);
		llmSyncInterval = null;
	}

	if (outboxInterval) {
		clearInterval(outboxInterval);
		outboxInterval = null;
	}
	if (graceInterval) {
		clearInterval(graceInterval);
		graceInterval = null;
	}

	isRunning = false;
	_logger.info("Billing worker stopped");
}

/**
 * Check if billing worker is healthy.
 */
export function isBillingWorkerHealthy(): boolean {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return true;
	}

	return isRunning;
}
