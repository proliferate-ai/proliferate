/**
 * Outbox worker for retrying failed billing events.
 *
 * The local ledger (billing_events table) acts as an outbox.
 * This worker picks up events that failed to post to Autumn and retries them.
 */

import type { SandboxProvider } from "@proliferate/shared";
import {
	AUTUMN_FEATURES,
	BILLING_REDIS_KEYS,
	type BillingEventType,
	METERING_CONFIG,
	acquireLock,
	autumnDeductCredits,
	releaseLock,
	renewLock,
} from "@proliferate/shared/billing";
import type IORedis from "ioredis";
import { and, asc, billingEvents, eq, getDb, inArray, lt, organization } from "../db/client";
import { getServicesLogger } from "../logger";
import { handleCreditsExhaustedV2 } from "./org-pause";

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
 * @param redis - Redis client for distributed locking
 * @param batchSize - Max events to process per cycle (default: 100)
 */
export async function processOutbox(
	redis: IORedis,
	providers?: Map<string, SandboxProvider>,
	batchSize = 100,
): Promise<void> {
	const lockToken = crypto.randomUUID();

	// Acquire lock
	const acquired = await acquireLock(
		redis,
		BILLING_REDIS_KEYS.outboxLock,
		lockToken,
		METERING_CONFIG.lockTtlMs,
	);

	const logger = getServicesLogger().child({ module: "outbox" });

	if (!acquired) {
		logger.debug("Another worker has the lock, skipping");
		return;
	}

	// Set up renewal interval with error handling
	let renewalFailed = false;
	const renewInterval = setInterval(async () => {
		try {
			await renewLock(redis, BILLING_REDIS_KEYS.outboxLock, lockToken, METERING_CONFIG.lockTtlMs);
		} catch (err) {
			logger.error({ err }, "Lock renewal failed");
			renewalFailed = true;
		}
	}, METERING_CONFIG.lockRenewIntervalMs);

	try {
		// Helper to check if we should abort due to lock renewal failure
		const checkLockValid = () => {
			if (renewalFailed) {
				throw new Error("Lock renewal failed - aborting outbox cycle to prevent conflicts");
			}
		};

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
			// Check lock validity before each event to fail fast if lock is lost
			checkLockValid();
			await processEvent(event, providers);
		}
	} finally {
		clearInterval(renewInterval);
		await releaseLock(redis, BILLING_REDIS_KEYS.outboxLock, lockToken);
	}
}

/**
 * Process a single pending event.
 */
async function processEvent(
	event: PendingBillingEvent,
	providers?: Map<string, SandboxProvider>,
): Promise<void> {
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

		// If Autumn denies, enforce exhausted state
		if (!result.allowed) {
			logger.warn("Autumn denied credits; enforcing exhausted state");
			await db
				.update(organization)
				.set({
					billingState: "exhausted",
					graceEnteredAt: null,
					graceExpiresAt: null,
				})
				.where(eq(organization.id, event.organizationId));
			await handleCreditsExhaustedV2(event.organizationId, providers);
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
			logger.error({ err, retryCount }, "Event permanently failed");
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
