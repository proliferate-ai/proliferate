/**
 * Outbox worker for retrying failed billing events.
 *
 * The local ledger (billing_events table) acts as an outbox.
 * This worker picks up events that failed to post to Autumn and retries them.
 */

import {
	AUTUMN_FEATURES,
	type BillingEventType,
	METERING_CONFIG,
	autumnDeductCredits,
} from "@proliferate/shared/billing";
import { getServicesLogger } from "../logger";
import { attemptAutoTopUp } from "./auto-topup";
import {
	findAutumnCustomerId,
	findOutboxStatsEvents,
	findRetryableEvents,
	markEventPosted,
	markOrgBillingExhausted,
	updateEventRetry,
} from "./db";
import { enforceCreditsExhausted } from "./org-pause";

// ============================================
// Types
// ============================================

interface PendingBillingEvent {
	id: string;
	organizationId: string;
	eventType: BillingEventType;
	credits: string;
	idempotencyKey: string;
	retryCount: number | null;
	lastError: string | null;
}

// ============================================
// Outbox Processing
// ============================================

/**
 * Process pending billing events that failed to post to Autumn.
 * Should be called every 60 seconds by a worker.
 *
 * @param batchSize - Max events to process per cycle (default: 100)
 */
export async function processOutbox(batchSize = 100): Promise<void> {
	const logger = getServicesLogger().child({ module: "outbox" });

	// Get pending/failed events ready for retry
	const events = (await findRetryableEvents(
		METERING_CONFIG.maxRetries,
		batchSize,
	)) as PendingBillingEvent[];

	if (!events.length) {
		return;
	}

	logger.info({ eventCount: events.length }, "Processing pending events");

	for (const event of events) {
		await processEvent(event);
	}
}

/**
 * Process a single pending event.
 */
async function processEvent(event: PendingBillingEvent): Promise<void> {
	const logger = getServicesLogger().child({
		module: "outbox",
		eventId: event.id,
		orgId: event.organizationId,
	});
	try {
		const credits = Number(event.credits);
		const org = await findAutumnCustomerId(event.organizationId);
		if (!org?.autumnCustomerId) {
			throw new Error("Organization is missing Autumn customer ID");
		}

		// Post to Autumn - all event types deduct from the 'credits' feature
		const result = await autumnDeductCredits(
			org.autumnCustomerId,
			AUTUMN_FEATURES.credits, // All events deduct credits
			credits,
			event.idempotencyKey,
		);

		// If Autumn denies, try auto-top-up before enforcing exhausted state
		if (!result.allowed) {
			const topup = await attemptAutoTopUp(event.organizationId, Number(event.credits));
			if (topup.success) {
				logger.info(
					{ creditsAdded: topup.creditsAdded },
					"Auto-top-up succeeded after Autumn denial",
				);
				return;
			}

			logger.warn("Autumn denied credits; enforcing exhausted state");
			await markOrgBillingExhausted(event.organizationId);
			const enforcement = await enforceCreditsExhausted(event.organizationId);
			if (enforcement.failed > 0) {
				throw new Error(
					`Failed to pause ${enforcement.failed} session(s) for credits-exhausted enforcement`,
				);
			}
		}

		// Mark as posted only after all denial/enforcement logic completes.
		await markEventPosted(event.id, result);

		logger.debug("Posted event");
	} catch (err) {
		// Calculate exponential backoff
		const retryCount = (event.retryCount ?? 0) + 1;
		const backoffMs = Math.min(
			METERING_CONFIG.baseBackoffMs * 2 ** retryCount,
			METERING_CONFIG.maxBackoffMs,
		);

		const status = retryCount >= METERING_CONFIG.maxRetries ? "failed" : "pending";

		await updateEventRetry(event.id, {
			status,
			retryCount,
			nextRetryAt: new Date(Date.now() + backoffMs),
			lastError: err instanceof Error ? err.message : String(err),
		});

		if (status === "failed") {
			logger.error(
				{ err, retryCount, credits: Number(event.credits), alert: true },
				"Event permanently failed",
			);
		} else {
			logger.warn({ err, retryCount }, "Event failed, will retry");
		}
	}
}

// ============================================
// Diagnostics
// ============================================

interface OutboxStats {
	pending: number;
	failed: number;
	permanentlyFailed: number;
	totalCreditsBlocked: number;
}

/**
 * Get outbox statistics for monitoring.
 */
export async function getOutboxStats(orgId?: string): Promise<OutboxStats> {
	const events = await findOutboxStatsEvents(orgId);

	const pending =
		events.filter(
			(e) =>
				e.status === "pending" ||
				(e.status === "failed" && (e.retryCount ?? 0) < METERING_CONFIG.maxRetries),
		).length ?? 0;

	const failed =
		events.filter((e) => e.status === "failed" && (e.retryCount ?? 0) < METERING_CONFIG.maxRetries)
			.length ?? 0;

	const permanentlyFailed =
		events.filter((e) => e.status === "failed" && (e.retryCount ?? 0) >= METERING_CONFIG.maxRetries)
			.length ?? 0;

	const totalCreditsBlocked = events.reduce((sum, e) => sum + (Number(e.credits) || 0), 0) ?? 0;

	return { pending, failed, permanentlyFailed, totalCreditsBlocked };
}
