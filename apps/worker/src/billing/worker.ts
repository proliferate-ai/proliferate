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
import { calculateLLMCredits } from "@proliferate/shared/billing";
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
 * Default lookback window for first-run orgs with no cursor (5 minutes).
 */
const LLM_SYNC_DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;

/**
 * Sync LLM spend to billing_events via REST API + bulk ledger deduction.
 *
 * For each billable org:
 * 1. Read per-org cursor (or default to 5-min lookback)
 * 2. Fetch spend logs from LiteLLM REST API
 * 3. Convert to BulkDeductEvent[] and bulk-deduct from shadow balance
 * 4. Advance cursor
 * 5. Handle state transitions (terminate sessions if exhausted)
 */
async function syncLLMSpend(): Promise<void> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return;
	}

	// Guard: REST API requires an admin-capable URL + master key
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	if (!proxyUrl || !env.LLM_PROXY_MASTER_KEY) {
		return;
	}

	const log = _logger.child({ op: "llm-sync" });

	try {
		const orgIds = await billing.listBillableOrgIds();
		if (!orgIds.length) {
			log.debug("No billable orgs");
			return;
		}

		let totalSynced = 0;
		let totalOrgs = 0;

		for (const orgId of orgIds) {
			try {
				const synced = await syncOrgLLMSpend(orgId);
				if (synced > 0) {
					totalSynced += synced;
					totalOrgs++;
				}
			} catch (err) {
				log.error({ err, orgId }, "Failed to sync LLM spend for org");
			}
		}

		if (totalSynced > 0) {
			log.info({ totalSynced, totalOrgs }, "LLM spend sync complete");
		}
	} catch (err) {
		log.error({ err }, "LLM spend sync cycle error");
	}
}

/**
 * Sync LLM spend for a single org. Returns number of events inserted.
 */
async function syncOrgLLMSpend(orgId: string): Promise<number> {
	const log = _logger.child({ op: "llm-sync", orgId });

	// 1. Read cursor
	const cursor = await billing.getLLMSpendCursor(orgId);
	const startDate = cursor
		? cursor.lastStartTime
		: new Date(Date.now() - LLM_SYNC_DEFAULT_LOOKBACK_MS);

	// 2. Fetch spend logs from REST API
	const logs = await billing.fetchSpendLogs(orgId, startDate);
	if (!logs.length) {
		return 0;
	}

	// 3. Sort logs by startTime ascending for deterministic cursor advancement.
	// LiteLLM's REST API does not guarantee sort order, so we enforce it client-side.
	logs.sort((a, b) => {
		const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
		const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
		if (ta !== tb) return ta - tb;
		return a.request_id.localeCompare(b.request_id);
	});

	// 4. Convert to BulkDeductEvent[]. We do NOT skip duplicates client-side —
	// bulkDeductShadowBalance uses ON CONFLICT (idempotency_key) DO NOTHING,
	// which is the authoritative dedup. This avoids the weak single-request_id
	// check that can miss same-timestamp rows.
	const events: billing.BulkDeductEvent[] = [];
	for (const entry of logs) {
		if (entry.spend <= 0) continue;

		const credits = calculateLLMCredits(entry.spend);
		events.push({
			credits,
			quantity: entry.spend,
			eventType: "llm",
			idempotencyKey: `llm:${entry.request_id}`,
			sessionIds: entry.end_user ? [entry.end_user] : [],
			metadata: {
				model: entry.model,
				total_tokens: entry.total_tokens,
				prompt_tokens: entry.prompt_tokens,
				completion_tokens: entry.completion_tokens,
				litellm_request_id: entry.request_id,
			},
		});
	}

	if (!events.length) {
		return 0;
	}

	// 5. Bulk deduct
	const result = await billing.bulkDeductShadowBalance(orgId, events);

	log.info(
		{
			fetched: logs.length,
			inserted: result.insertedCount,
			creditsDeducted: result.totalCreditsDeducted,
			balance: result.newBalance,
		},
		"Synced LLM spend",
	);

	// 6. Advance cursor to the last sorted log's startTime.
	// Use the last log in sorted order so we don't skip ahead past unprocessed rows.
	const lastLog = logs[logs.length - 1];
	const latestStartTime = lastLog.startTime ? new Date(lastLog.startTime) : startDate;

	await billing.updateLLMSpendCursor({
		organizationId: orgId,
		lastStartTime: latestStartTime,
		lastRequestId: lastLog.request_id,
		recordsProcessed: (cursor?.recordsProcessed ?? 0) + result.insertedCount,
		syncedAt: new Date(),
	});

	// 7. Handle state transitions
	if (result.shouldTerminateSessions) {
		// Check trial auto-activation before terminating (parity with compute metering)
		const activation = await billing.tryActivatePlanAfterTrial(orgId);
		if (activation.activated) {
			log.info("Trial auto-activated via LLM spend; skipping termination");
			return result.insertedCount;
		}

		log.info(
			{ enforcementReason: result.enforcementReason },
			"Balance exhausted — terminating sessions",
		);
		const providers = await getProvidersMap();
		await billing.handleCreditsExhaustedV2(orgId, providers);
	} else if (result.shouldBlockNewSessions) {
		log.info({ enforcementReason: result.enforcementReason }, "Entering grace period");
	}

	return result.insertedCount;
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
