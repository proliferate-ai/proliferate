/**
 * Billing Worker
 *
 * Runs periodic billing tasks:
 * - Compute metering (every 30 seconds)
 * - LLM spend sync (every 30 seconds)
 * - Outbox processing (every 60 seconds)
 */

import { env } from "@proliferate/environment/server";
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
		console.error("[BillingWorker] Metering cycle error:", error);
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
		console.error("[BillingWorker] Outbox processing error:", error);
	}
}

/**
 * Sync LLM spend from LiteLLM_SpendLogs to billing_events using cursor-based pagination.
 * LiteLLM automatically logs to LiteLLM_SpendLogs when database_url is configured.
 * We read those logs and insert into billing_events for unified Autumn sync.
 *
 * V2 Changes:
 * - Cursor-based ingestion (startTime + request_id ordering)
 * - 5-minute lookback on first run
 * - Batch size > 100 and loop until empty
 * - Uses shadow balance for atomic credit deduction
 */
async function syncLLMSpend(): Promise<void> {
	if (!env.NEXT_PUBLIC_BILLING_ENABLED) {
		return;
	}

	try {
		const { calculateLLMCredits, METERING_CONFIG } = await import("@proliferate/shared/billing");
		const providers = await getProvidersMap();
		const normalizeTokenCount = (value: number | null | undefined) =>
			Number.isFinite(value) ? value : null;

		// Get current cursor (or bootstrap)
		let cursor = await billing.getLLMSpendCursor();
		const bootstrapMode = process.env.LLM_SYNC_BOOTSTRAP_MODE ?? "recent";

		if (!cursor && bootstrapMode === "full") {
			const earliestLog = await billing.getLLMSpendMinStartTime();
			if (earliestLog) {
				cursor = {
					lastStartTime: earliestLog,
					lastRequestId: null,
					recordsProcessed: 0,
					syncedAt: new Date(),
				};
				console.log(`[LLMSync] Bootstrap(full): seeding cursor at ${earliestLog.toISOString()}`);
			} else {
				console.log("[LLMSync] Bootstrap(full): no spend logs found");
			}
		}

		const isBootstrap = !cursor;
		if (isBootstrap) {
			console.log(`[LLMSync] No cursor found; mode=${bootstrapMode}`);
			if (bootstrapMode !== "full") {
				console.log(
					`[LLMSync] Using recent lookback (${METERING_CONFIG.llmSyncBootstrapLookbackMs}ms). Set LLM_SYNC_BOOTSTRAP_MODE=full for backfill.`,
				);
			}
		}
		let totalProcessed = 0;
		let batchCount = 0;
		const defaultMaxBatches = isBootstrap ? 20 : 100;
		const rawMaxBatches = Number(process.env.LLM_SYNC_MAX_BATCHES ?? defaultMaxBatches);
		const maxBatches =
			Number.isFinite(rawMaxBatches) && rawMaxBatches > 0 ? rawMaxBatches : defaultMaxBatches;
		const processedRequestIds = new Set<string>();
		let lastBatchSize = 0;

		// Loop until we've processed all available logs
		while (batchCount < maxBatches) {
			const logs = await billing.getLLMSpendLogsByCursor(cursor, METERING_CONFIG.llmSyncBatchSize);

			if (logs.length === 0) {
				// No more logs to process
				break;
			}

			batchCount++;
			lastBatchSize = logs.length;
			console.log(`[LLMSync] Processing batch ${batchCount}: ${logs.length} spend logs`);

			for (const log of logs) {
				// Validate spend is a positive finite number (guard against NaN/Infinity from external input)
				if (!log.team_id || !Number.isFinite(log.spend) || log.spend <= 0) continue;
				const totalTokens = normalizeTokenCount(log.total_tokens);
				const promptTokens = normalizeTokenCount(log.prompt_tokens);
				const completionTokens = normalizeTokenCount(log.completion_tokens);

				const credits = calculateLLMCredits(log.spend);

				// Use shadow balance for atomic deduction
				const result = await billing.deductShadowBalance({
					organizationId: log.team_id,
					quantity: credits,
					credits,
					eventType: "llm",
					idempotencyKey: `llm:${log.request_id}`,
					sessionIds: log.user ? [log.user] : [],
					metadata: {
						model: log.model,
						model_group: log.model_group,
						total_tokens: totalTokens,
						prompt_tokens: promptTokens,
						completion_tokens: completionTokens,
						actual_cost_usd: log.spend,
						litellm_request_id: log.request_id,
					},
				});

				if (result.success) {
					totalProcessed++;
					processedRequestIds.add(log.request_id);

					// Handle state transitions
					if (result.shouldTerminateSessions) {
						if (result.previousState === "trial" && result.newState === "exhausted") {
							const activation = await billing.tryActivatePlanAfterTrial(log.team_id);
							if (activation.activated) {
								console.log(
									`[LLMSync] Org ${log.team_id} trial auto-activated; skipping termination`,
								);
								continue;
							}
						}
						console.log(
							`[LLMSync] Org ${log.team_id} balance exhausted, should terminate sessions: ${result.enforcementReason}`,
						);
						await billing.handleCreditsExhaustedV2(log.team_id, providers);
					} else if (result.shouldBlockNewSessions) {
						console.log(
							`[LLMSync] Org ${log.team_id} entering grace period: ${result.enforcementReason}`,
						);
					}
				}
			}

			// Update cursor after processing batch
			const newCursor = billing.getNewCursorFromLogs(logs, cursor);
			if (newCursor) {
				cursor = newCursor;
				await billing.updateLLMSpendCursor(cursor);
			}

			// If we got fewer logs than batch size, we've reached the end
			if (logs.length < METERING_CONFIG.llmSyncBatchSize) {
				break;
			}
		}

		// Lookback sweep for late-arriving logs (does not advance cursor)
		const lookbackLogs = await billing.getLLMSpendLogsLookback(
			METERING_CONFIG.llmSyncLookbackMs,
			METERING_CONFIG.llmSyncBatchSize,
		);

		for (const log of lookbackLogs) {
			if (processedRequestIds.has(log.request_id)) continue;
			if (!log.team_id || !Number.isFinite(log.spend) || log.spend <= 0) continue;
			const totalTokens = normalizeTokenCount(log.total_tokens);
			const promptTokens = normalizeTokenCount(log.prompt_tokens);
			const completionTokens = normalizeTokenCount(log.completion_tokens);

			const credits = calculateLLMCredits(log.spend);
			const result = await billing.deductShadowBalance({
				organizationId: log.team_id,
				quantity: credits,
				credits,
				eventType: "llm",
				idempotencyKey: `llm:${log.request_id}`,
				sessionIds: log.user ? [log.user] : [],
				metadata: {
					model: log.model,
					model_group: log.model_group,
					total_tokens: totalTokens,
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					actual_cost_usd: log.spend,
					litellm_request_id: log.request_id,
					late_log: true,
				},
			});

			if (result.success) {
				totalProcessed++;
			}
		}

		if (totalProcessed > 0) {
			console.log(`[LLMSync] Synced ${totalProcessed} LLM spend logs in ${batchCount} batches`);
		}
		if (batchCount >= maxBatches && lastBatchSize === METERING_CONFIG.llmSyncBatchSize) {
			console.log(
				`[LLMSync] Reached max batches (${maxBatches})${isBootstrap ? " during bootstrap" : ""}; more logs may remain. Increase LLM_SYNC_MAX_BATCHES if needed.`,
			);
		}
	} catch (error) {
		console.error("[LLMSync] Error syncing LLM spend:", error);
	}
}

/**
 * Check for expired grace periods and enforce exhausted state.
 */
async function checkGraceExpirations(): Promise<void> {
	if (!env.AUTUMN_API_URL || !env.AUTUMN_API_KEY) {
		return;
	}

	try {
		const expiredOrgs = await orgs.listGraceExpiredOrgs();
		if (!expiredOrgs.length) return;

		const providers = await getProvidersMap();
		for (const org of expiredOrgs) {
			try {
				await orgs.expireGraceForOrg(org.id);
				await billing.handleCreditsExhaustedV2(org.id, providers);
				console.log(`[Grace] Org ${org.id} grace expired -> exhausted`);
			} catch (err) {
				console.error(`[Grace] Failed to expire grace for org ${org.id}:`, err);
			}
		}
	} catch (err) {
		console.error("[Grace] Error checking grace expirations:", err);
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
export function startBillingWorker(): void {
	if (isRunning) {
		console.warn("[BillingWorker] Already running");
		return;
	}

	console.log("[BillingWorker] Starting billing worker...");

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

	console.log("[BillingWorker] Billing worker started:");
	console.log("  - Metering cycle: every 30 seconds");
	console.log("  - LLM spend sync: every 30 seconds");
	console.log("  - Outbox processing: every 60 seconds");

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

	console.log("[BillingWorker] Stopping billing worker...");

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
	console.log("[BillingWorker] Billing worker stopped");
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
