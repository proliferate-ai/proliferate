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
import { and, asc, billingEvents, eq, getDb, inArray, lt, organization } from "../db/client";
import { getServicesLogger } from "../logger";
import { attemptAutoTopUp } from "./auto-topup";
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
	const db = getDb();

	// Get pending/failed events ready for retry
	const events = (await db.query.billingEvents.findMany({
		where: and(
			inArray(billingEvents.status, ["pending", "failed"]),
			lt(billingEvents.retryCount, METERING_CONFIG.maxRetries),
			lt(billingEvents.nextRetryAt, new Date()),
		),
		columns: {
			id: true,
			organizationId: true,
			eventType: true,
			credits: true,
			idempotencyKey: true,
			retryCount: true,
			lastError: true,
		},
		orderBy: [asc(billingEvents.createdAt)],
		limit: batchSize,
	})) as PendingBillingEvent[];

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
	const db = getDb();
	try {
		const credits = Number(event.credits);
		// Post to Autumn - all event types deduct from the 'credits' feature
		const result = await autumnDeductCredits(
			event.organizationId,
			AUTUMN_FEATURES.credits, // All events deduct credits
			credits,
			event.idempotencyKey,
		);

		// Mark as posted
		await db
			.update(billingEvents)
			.set({
				status: "posted",
				autumnResponse: result,
			})
			.where(eq(billingEvents.id, event.id));

		logger.debug("Posted event");

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
			await db
				.update(organization)
				.set({
					billingState: "exhausted",
					graceEnteredAt: null,
					graceExpiresAt: null,
				})
				.where(eq(organization.id, event.organizationId));
			await enforceCreditsExhausted(event.organizationId);
		}
	} catch (err) {
		// Calculate exponential backoff
		const retryCount = (event.retryCount ?? 0) + 1;
		const backoffMs = Math.min(
			METERING_CONFIG.baseBackoffMs * 2 ** retryCount,
			METERING_CONFIG.maxBackoffMs,
		);

		const status = retryCount >= METERING_CONFIG.maxRetries ? "failed" : "pending";

		await db
			.update(billingEvents)
			.set({
				status,
				retryCount,
				nextRetryAt: new Date(Date.now() + backoffMs),
				lastError: err instanceof Error ? err.message : String(err),
			})
			.where(eq(billingEvents.id, event.id));

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
	const db = getDb();
	const baseWhere = orgId
		? and(
				eq(billingEvents.organizationId, orgId),
				inArray(billingEvents.status, ["pending", "failed"]),
			)
		: inArray(billingEvents.status, ["pending", "failed"]);

	const events = await db.query.billingEvents.findMany({
		where: baseWhere,
		columns: {
			status: true,
			retryCount: true,
			credits: true,
		},
	});

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
